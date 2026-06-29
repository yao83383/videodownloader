const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 8090;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const MAX_DEVICES = Number(process.env.MAX_DEVICES || 1);
// 后台页面的"秘密路径"（默认 admin；建议在 docker-compose 里改成不可猜的串，如 console-9f3a2x7k）
const ADMIN_PATH = (process.env.ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '');

const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH || path.join(__dirname, 'private.pem');
const LICENSES_PATH = process.env.LICENSES_PATH || path.join(__dirname, 'licenses.json');
const ORDERS_PATH = process.env.ORDERS_PATH || path.join(path.dirname(LICENSES_PATH), 'orders.json');

// XorPay 支付配置
const XORPAY_APP_ID = process.env.XORPAY_APP_ID || '';
const XORPAY_APP_SECRET = process.env.XORPAY_APP_SECRET || '';
const XORPAY_API = `https://xorpay.com/api/pay/${XORPAY_APP_ID}`;
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8090';

// 自助充值套餐（JSON 字符串，key 须含 price/days/id/name）
function loadPackages() {
  try { return JSON.parse(process.env.PACKAGES || '[]'); } catch { return []; }
}

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error('缺少 private.pem，请先运行: npm run genkeys');
  process.exit(1);
}
const PRIVATE_KEY = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));

function loadLicenses() {
  try {
    return JSON.parse(fs.readFileSync(LICENSES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveLicenses(data) {
  fs.writeFileSync(LICENSES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8')); } catch { return {}; }
}
function saveOrders(data) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// XorPay MD5 签名：按文档顺序拼接值，末尾拼 secret
function xorpaySign(...args) {
  return crypto.createHash('md5').update(args.join('') + XORPAY_APP_SECRET, 'utf8').digest('hex');
}

function sign(message) {
  return crypto.sign(null, Buffer.from(message, 'utf8'), PRIVATE_KEY).toString('base64');
}

function signedResponse(payload) {
  const message = [
    payload.key,
    payload.deviceId,
    String(payload.valid),
    payload.expiry || '',
    payload.nonce,
    String(payload.serverTime),
  ].join('|');
  return { ...payload, sig: sign(message) };
}

function signConsume(payload) {
  const message = [
    payload.key,
    payload.deviceId,
    String(payload.ok),
    String(payload.remaining),
    payload.nonce,
    String(payload.serverTime),
  ].join('|');
  return { ...payload, sig: sign(message) };
}

function randomKey() {
  const block = () =>
    crypto.randomBytes(2).toString('hex').toUpperCase();
  return `VD-${block()}-${block()}-${block()}`;
}

const app = express();
app.set('trust proxy', true); // 经 Nginx 反代，使 req.ip 取 X-Forwarded-For
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/', (_req, res) => res.type('text').send('VideoDownloader License Server OK'));

// 全局遥控开关：放一个 status.json 在数据目录，改它就能关掉所有客户端
const STATUS_PATH = path.join(path.dirname(LICENSES_PATH), 'status.json');
app.get('/status.json', (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')));
  } catch {
    res.json({ ok: true });
  }
});

// 管理后台页面：只在“秘密路径”下提供（由 ADMIN_PATH 决定），不在 /admin 暴露页面
app.get(['/' + ADMIN_PATH, '/' + ADMIN_PATH + '/'], (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

// 自助充值页面（公开）
app.get('/recharge', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'recharge.html')));

app.post('/verify', (req, res) => {
  const { key, deviceId, nonce } = req.body || {};
  const serverTime = Date.now();
  const base = { key: key || '', deviceId: deviceId || '', nonce: nonce || '', serverTime };

  if (!key || !deviceId || !nonce) {
    return res.json(signedResponse({ ...base, valid: false, expiry: '', reason: '参数缺失' }));
  }

  const licenses = loadLicenses();
  const rec = licenses[key];

  if (!rec) {
    return res.json(signedResponse({ ...base, valid: false, expiry: '', reason: '无效的授权码' }));
  }
  if (rec.disabled) {
    return res.json(signedResponse({ ...base, valid: false, expiry: rec.expiry || '', reason: '授权已停用' }));
  }

  const devices = Array.isArray(rec.devices) ? rec.devices : [];
  if (!devices.includes(deviceId)) {
    if (devices.length >= MAX_DEVICES) {
      return res.json(
        signedResponse({ ...base, valid: false, expiry: rec.expiry || '', reason: '授权码已绑定其他设备' })
      );
    }
    devices.push(deviceId);
    rec.devices = devices;
    rec.boundAt = rec.boundAt || new Date().toISOString();
    licenses[key] = rec;
    saveLicenses(licenses);
  }

  const expired = rec.expiry && new Date(rec.expiry).getTime() < serverTime;
  if (expired) {
    return res.json(signedResponse({ ...base, valid: false, expiry: rec.expiry, reason: '授权已过期' }));
  }

  const okResp = signedResponse({ ...base, valid: true, expiry: rec.expiry || '', reason: 'ok' });
  okResp.quota = typeof rec.quota === 'number' ? rec.quota : null;
  okResp.remaining = typeof rec.quota === 'number' ? rec.quota - Number(rec.used || 0) : null;
  return res.json(okResp);
});

// 扣次：下载前调用。无 quota 的码放行不扣；有 quota 则 used+1，用尽则拒绝。
app.post('/consume', (req, res) => {
  const { key, deviceId, nonce } = req.body || {};
  const serverTime = Date.now();
  const base = { key: key || '', deviceId: deviceId || '', nonce: nonce || '', serverTime };

  if (!key || !deviceId || !nonce) {
    return res.json(signConsume({ ...base, ok: false, remaining: '', reason: '参数缺失' }));
  }
  const licenses = loadLicenses();
  const rec = licenses[key];
  if (!rec) return res.json(signConsume({ ...base, ok: false, remaining: '', reason: '无效的授权码' }));
  if (rec.disabled) return res.json(signConsume({ ...base, ok: false, remaining: '', reason: '授权已停用' }));
  if (!(Array.isArray(rec.devices) ? rec.devices : []).includes(deviceId)) {
    return res.json(signConsume({ ...base, ok: false, remaining: '', reason: '设备未授权' }));
  }
  if (rec.expiry && new Date(rec.expiry).getTime() < serverTime) {
    return res.json(signConsume({ ...base, ok: false, remaining: '', reason: '授权已过期' }));
  }

  if (typeof rec.quota === 'number') {
    const used = Number(rec.used || 0);
    if (used >= rec.quota) {
      return res.json(signConsume({ ...base, ok: false, remaining: 0, reason: '下载次数已用尽' }));
    }
    rec.used = used + 1;
    rec.lastDownloadAt = new Date().toISOString();
    licenses[key] = rec;
    saveLicenses(licenses);
    return res.json(signConsume({ ...base, ok: true, remaining: rec.quota - rec.used, reason: 'ok' }));
  }
  // 不限次
  return res.json(signConsume({ ...base, ok: true, remaining: '', reason: 'ok' }));
});

// 退次：下载失败时调用，used-1（下限 0，保证不会超发）。
app.post('/refund', (req, res) => {
  const { key, deviceId, nonce } = req.body || {};
  const serverTime = Date.now();
  const base = { key: key || '', deviceId: deviceId || '', nonce: nonce || '', serverTime };
  const licenses = loadLicenses();
  const rec = licenses[key];
  if (rec && typeof rec.quota === 'number' && Number(rec.used || 0) > 0) {
    rec.used = Number(rec.used) - 1;
    licenses[key] = rec;
    saveLicenses(licenses);
    return res.json(signConsume({ ...base, ok: true, remaining: rec.quota - rec.used, reason: 'refunded' }));
  }
  const remaining = rec && typeof rec.quota === 'number' ? rec.quota - Number(rec.used || 0) : '';
  return res.json(signConsume({ ...base, ok: true, remaining, reason: 'noop' }));
});

// 返回可选套餐（供充值页读取）
app.get('/order/packages', (_req, res) => res.json(loadPackages()));

app.post('/order/create', (req, res) => {
  const { plan, pay_type } = req.body || {};
  const pt = pay_type === 'alipay' ? 'alipay' : 'native';
  const pkgs = loadPackages();
  const pkg = pkgs.find((p) => p.id === plan);
  if (!pkg) return res.status(400).json({ error: '未知套餐' });

  const orderId = 'XR' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  const notifyUrl = BASE_URL + '/pay-callback';
  // 签名顺序：name + pay_type + price + order_id + notify_url + secret
  const sign = xorpaySign(pkg.name, pt, String(pkg.price), orderId, notifyUrl);
  const body = new URLSearchParams({
    name: pkg.name,
    pay_type: pt,
    price: String(pkg.price),
    order_id: orderId,
    notify_url: notifyUrl,
    sign,
  }).toString();

  const https = require('https');
  const reqXor = https.request(
    XORPAY_API,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
    (xres) => {
      let d = '';
      xres.on('data', (c) => (d += c));
      xres.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = {}; }
        if (parsed.status !== 'ok') return res.json({ ok: false, error: parsed.status || '下单失败' });

        const orders = loadOrders();
        const qrUrl = (parsed.info && parsed.info.qr) || '';
        // 从 QR URL 中提取 XorPay 通道流水号（如 ?orderId=92070421462599077888）
        let txnId = '';
        try { txnId = new URL(qrUrl).searchParams.get('orderId') || ''; } catch { /* ignore */ }
        orders[orderId] = { plan: pkg.id, price: pkg.price, name: pkg.name, paid: false, createdAt: new Date().toISOString(), txnId };
        saveOrders(orders);

        res.json({ ok: true, orderId, qr: qrUrl });
      });
    }
  );
  reqXor.on('error', () => res.status(500).json({ ok: false, error: '支付接口异常' }));
  reqXor.write(body);
  reqXor.end();
});

app.get('/order/status', (req, res) => {
  const orderId = (req.query.orderId || '').trim();
  if (!orderId) return res.status(400).json({ error: '缺少 orderId' });
  const orders = loadOrders();
  const order = orders[orderId];
  if (!order) return res.json({ paid: false, msg: '订单不存在' });
  if (!order.paid) return res.json({ paid: false, msg: '待支付' });

  res.json({ paid: true, key: order.licenseKey || '', msg: order.note || '', txId: order.payTransactionId || '' });
});

app.post('/pay-callback', (req, res) => {
  const payload = req.body || {};
  // XorPay 回调验签：aoid + order_id + pay_price + pay_time + secret
  const cbSign = xorpaySign(
    payload.aoid || '',
    payload.order_id || '',
    String(payload.pay_price || ''),
    String(payload.pay_time || '')
  );
  if (cbSign !== (payload.sign || '')) return res.status(403).send('sign error');

  const orderId = payload.order_id;
  const orders = loadOrders();
  const order = orders[orderId];
  if (!order || order.paid) return res.send('success');

  order.paid = true;
  order.paidAt = new Date().toISOString();
  order.payPrice = Number(payload.pay_price || 0);
  order.payTransactionId = (() => {
    try {
      const d = JSON.parse(payload.detail || '{}');
      return d.transaction_id || d.trade_no || '';
    } catch { return ''; }
  })();

  // 自动生成授权码
  const pkg = (loadPackages()).find((p) => p.id === order.plan) || {};
  const days = Number(pkg.days || 30);
  const quota = pkg.quota !== undefined ? Number(pkg.quota) : undefined;

  const licenses = loadLicenses();
  const key = order.payTransactionId || order.txnId || payload.aoid || orderId;

  const rec = {
    expiry: new Date(Date.now() + days * 86400000).toISOString(),
    disabled: false,
    devices: [],
    note: `${pkg.name || order.plan}（自助购买）`,
    createdAt: new Date().toISOString(),
    source: 'recharge',
    orderId,
  };
  if (quota !== undefined) { rec.quota = quota; rec.used = 0; }
  licenses[key] = rec;
  saveLicenses(licenses);

  order.licenseKey = key;
  saveOrders(orders);

  res.send('success');
});

// ----------
const adminFails = new Map(); // ip -> { count, windowEnd, until }
const ADMIN_MAX_FAILS = 8;
const ADMIN_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_BLOCK_MS = 15 * 60 * 1000;

function requireAdmin(req, res, next) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const rec = adminFails.get(ip);
  if (rec && rec.until && now < rec.until) {
    return res.status(429).json({ error: '尝试过多，请稍后再试' });
  }
  if ((req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) {
    const inWindow = rec && rec.windowEnd && now < rec.windowEnd;
    const count = inWindow ? rec.count + 1 : 1;
    const windowEnd = inWindow ? rec.windowEnd : now + ADMIN_WINDOW_MS;
    const entry = { count, windowEnd };
    if (count >= ADMIN_MAX_FAILS) entry.until = now + ADMIN_BLOCK_MS;
    adminFails.set(ip, entry);
    return res.status(401).json({ error: '管理员令牌错误' });
  }
  adminFails.delete(ip);
  next();
}

app.get('/admin/list', requireAdmin, (req, res) => {
  res.json(loadLicenses());
});

// 按设备码查询：客户把软件里的"设备码"发给你，这里查它绑定的授权码及状态
app.get('/admin/lookup', requireAdmin, (req, res) => {
  const device = String(req.query.device || '').trim();
  if (!device) return res.status(400).json({ error: '缺少 device' });
  const licenses = loadLicenses();
  const matches = [];
  for (const [key, rec] of Object.entries(licenses)) {
    if ((rec.devices || []).includes(device)) {
      const expired = rec.expiry && new Date(rec.expiry).getTime() < Date.now();
      matches.push({
        key,
        expiry: rec.expiry || '',
        disabled: !!rec.disabled,
        expired: !!expired,
        note: rec.note || '',
        deviceCount: (rec.devices || []).length,
      });
    }
  }
  res.json({ device, matches });
});

app.post('/admin/set', requireAdmin, (req, res) => {
  const { key, expiry, disabled, note, quota, used } = req.body || {};
  if (!key) return res.status(400).json({ error: '缺少 key' });
  const licenses = loadLicenses();
  const rec = licenses[key] || { devices: [], createdAt: new Date().toISOString() };
  if (expiry !== undefined) rec.expiry = expiry;
  if (disabled !== undefined) rec.disabled = !!disabled;
  if (note !== undefined) rec.note = note;
  if (quota !== undefined) {
    if (quota === null || quota === '') delete rec.quota; // 改为不限次
    else rec.quota = Math.max(0, Number(quota) || 0);
  }
  if (used !== undefined) rec.used = Math.max(0, Number(used) || 0);
  licenses[key] = rec;
  saveLicenses(licenses);
  res.json({ ok: true, key, record: rec });
});

app.post('/admin/reset-device', requireAdmin, (req, res) => {
  const { key } = req.body || {};
  const licenses = loadLicenses();
  if (!licenses[key]) return res.status(404).json({ error: '授权码不存在' });
  licenses[key].devices = [];
  licenses[key].boundAt = null;
  saveLicenses(licenses);
  res.json({ ok: true });
});

app.post('/admin/gen', requireAdmin, (req, res) => {
  const { count, days, note, quota } = req.body || {};
  const n = Math.max(1, Math.min(500, Number(count) || 1));
  const hasQuota = quota !== undefined && quota !== null && quota !== '';
  const quotaNum = hasQuota ? Math.max(0, Number(quota) || 0) : undefined;
  const licenses = loadLicenses();
  const created = [];
  const expiry = days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : '';
  for (let i = 0; i < n; i++) {
    let key = randomKey();
    while (licenses[key]) key = randomKey();
    const rec = { expiry, disabled: false, devices: [], note: note || '', createdAt: new Date().toISOString(), source: 'manual' };
    if (hasQuota) {
      rec.quota = quotaNum;
      rec.used = 0;
    }
    licenses[key] = rec;
    created.push(key);
  }
  saveLicenses(licenses);
  res.json({ ok: true, created, expiry });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`License server listening on http://0.0.0.0:${PORT}`);
  console.log(`Admin token: ${ADMIN_TOKEN === 'change-me-admin-token' ? '(默认，请用环境变量 ADMIN_TOKEN 修改)' : '(已自定义)'}`);
});
