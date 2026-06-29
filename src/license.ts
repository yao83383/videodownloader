import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { app } from 'electron';

// ===== 配置：部署你的服务器后填这里 =====
// 你的授权服务器地址（不要带结尾斜杠）
export const SERVER_URL = '';
// 与服务器 private.pem 配对的公钥（Ed25519）
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuemEb6vqFfhcaAzB3fsILdSaX7OobiZAeboYj26wk08=
-----END PUBLIC KEY-----
`;
// 断网宽容期（天）：联网成功过一次后，断网仍可用的天数
export const GRACE_DAYS = 7;
// =======================================

export interface LicenseStatus {
  enabled: boolean;
  licensed: boolean;
  reason: string;
  expiry: string;
  deviceId: string;
  quota?: number | null;
  remaining?: number | null;
}

const licensingEnabled = SERVER_URL.trim().length > 0 && LICENSE_PUBLIC_KEY.trim().length > 0;

let cachedLicensed = !licensingEnabled;
let lastQuota: number | null = null;

function statePath(): string {
  return path.join(app.getPath('userData'), 'license.json');
}

function loadState(): { key?: string; lastGood?: { expiry: string; checkedAt: number } } {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state: object): void {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

export function getDeviceId(): string {
  const macs: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') macs.push(ni.mac);
    }
  }
  macs.sort();
  const basis = `${macs[0] || 'no-mac'}|${os.hostname()}`;
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

function postJson(urlStr: string, body: object, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return reject(new Error('bad-url'));
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const lib = url.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    };
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('bad-response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

function verifySignature(payload: any, sentKey: string, sentDevice: string, sentNonce: string): boolean {
  try {
    const message = [
      sentKey,
      sentDevice,
      String(payload.valid),
      payload.expiry || '',
      sentNonce,
      String(payload.serverTime),
    ].join('|');
    const pub = crypto.createPublicKey(LICENSE_PUBLIC_KEY);
    return crypto.verify(null, Buffer.from(message, 'utf8'), pub, Buffer.from(payload.sig || '', 'base64'));
  } catch {
    return false;
  }
}

async function verifyOnline(
  key: string
): Promise<{
  network: false;
  valid: boolean;
  expiry: string;
  reason: string;
  quota: number | null;
  remaining: number | null;
}> {
  const deviceId = getDeviceId();
  const nonce = crypto.randomBytes(16).toString('hex');
  let res: any;
  try {
    res = await postJson(`${SERVER_URL}/verify`, { key, deviceId, nonce });
  } catch (e) {
    throw Object.assign(new Error('network'), { network: true });
  }
  if (!verifySignature(res, key, deviceId, nonce)) {
    return { network: false, valid: false, expiry: res.expiry || '', reason: '响应签名无效', quota: null, remaining: null };
  }
  const quota = typeof res.quota === 'number' ? res.quota : null;
  const remaining = typeof res.remaining === 'number' ? res.remaining : null;
  return { network: false, valid: !!res.valid, expiry: res.expiry || '', reason: res.reason || '', quota, remaining };
}

export async function computeStatus(): Promise<LicenseStatus> {
  const deviceId = getDeviceId();
  if (!licensingEnabled) {
    cachedLicensed = true;
    return { enabled: false, licensed: true, reason: '', expiry: '', deviceId };
  }

  const state = loadState();
  if (!state.key) {
    cachedLicensed = false;
    return { enabled: true, licensed: false, reason: '请输入授权码', expiry: '', deviceId };
  }

  try {
    const r = await verifyOnline(state.key);
    if (r.valid) {
      saveState({ key: state.key, lastGood: { expiry: r.expiry, checkedAt: Date.now() } });
      cachedLicensed = true;
      lastQuota = r.quota;
      return { enabled: true, licensed: true, reason: '', expiry: r.expiry, deviceId, quota: r.quota, remaining: r.remaining };
    }
    cachedLicensed = false;
    return { enabled: true, licensed: false, reason: r.reason || '授权无效', expiry: r.expiry, deviceId, quota: r.quota, remaining: r.remaining };
  } catch {
    const lg = state.lastGood;
    const withinGrace = !!lg && Date.now() - lg.checkedAt <= GRACE_DAYS * 86400000;
    const notExpired = !!lg && (!lg.expiry || new Date(lg.expiry).getTime() >= Date.now());
    if (withinGrace && notExpired) {
      cachedLicensed = true;
      return { enabled: true, licensed: true, reason: '离线宽容期', expiry: lg!.expiry, deviceId };
    }
    cachedLicensed = false;
    return {
      enabled: true,
      licensed: false,
      reason: '无法连接授权服务器，且离线宽容期已过，请联网后重试',
      expiry: lg?.expiry || '',
      deviceId,
    };
  }
}

export async function activate(key: string): Promise<LicenseStatus> {
  const deviceId = getDeviceId();
  if (!licensingEnabled) {
    cachedLicensed = true;
    return { enabled: false, licensed: true, reason: '', expiry: '', deviceId };
  }
  const trimmed = (key || '').trim();
  if (!trimmed) {
    return { enabled: true, licensed: false, reason: '请输入授权码', expiry: '', deviceId };
  }
  try {
    const r = await verifyOnline(trimmed);
    if (r.valid) {
      saveState({ key: trimmed, lastGood: { expiry: r.expiry, checkedAt: Date.now() } });
      cachedLicensed = true;
      lastQuota = r.quota;
      return { enabled: true, licensed: true, reason: '', expiry: r.expiry, deviceId, quota: r.quota, remaining: r.remaining };
    }
    cachedLicensed = false;
    return { enabled: true, licensed: false, reason: r.reason || '授权无效', expiry: r.expiry, deviceId, quota: r.quota, remaining: r.remaining };
  } catch {
    cachedLicensed = false;
    return { enabled: true, licensed: false, reason: '无法连接授权服务器，请检查网络', expiry: '', deviceId };
  }
}

export function isLicensed(): boolean {
  return cachedLicensed;
}

export function isLicensingEnabled(): boolean {
  return licensingEnabled;
}

function verifyConsumeSig(res: any, key: string, deviceId: string, nonce: string): boolean {
  try {
    const message = [key, deviceId, String(res.ok), String(res.remaining), nonce, String(res.serverTime)].join('|');
    const pub = crypto.createPublicKey(LICENSE_PUBLIC_KEY);
    return crypto.verify(null, Buffer.from(message, 'utf8'), pub, Buffer.from(res.sig || '', 'base64'));
  } catch {
    return false;
  }
}

async function consume(): Promise<{ ok: boolean; remaining: number | null; reason: string }> {
  const state = loadState();
  if (!state.key) return { ok: false, remaining: null, reason: '未授权' };
  const deviceId = getDeviceId();
  const nonce = crypto.randomBytes(16).toString('hex');
  let res: any;
  try {
    res = await postJson(`${SERVER_URL}/consume`, { key: state.key, deviceId, nonce });
  } catch {
    return { ok: false, remaining: null, reason: '无法连接授权服务器（按次数授权需联网）' };
  }
  if (!verifyConsumeSig(res, state.key, deviceId, nonce)) {
    return { ok: false, remaining: null, reason: '扣次响应签名无效' };
  }
  const remaining = typeof res.remaining === 'number' ? res.remaining : null;
  return { ok: !!res.ok, remaining, reason: res.reason || '' };
}

export async function refund(): Promise<void> {
  if (!licensingEnabled) return;
  const state = loadState();
  if (!state.key) return;
  const deviceId = getDeviceId();
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    await postJson(`${SERVER_URL}/refund`, { key: state.key, deviceId, nonce });
  } catch {
    // best-effort
  }
}

// 下载门禁：不限次的码直接放行（可离线）；有额度的码联网扣次。
export async function beginDownload(): Promise<{
  ok: boolean;
  remaining: number | null;
  metered: boolean;
  reason: string;
}> {
  if (!licensingEnabled) return { ok: true, remaining: null, metered: false, reason: '' };
  if (!cachedLicensed) return { ok: false, remaining: null, metered: false, reason: '未授权或授权已过期' };
  if (lastQuota == null) {
    return { ok: true, remaining: null, metered: false, reason: '' };
  }
  const c = await consume();
  return { ok: c.ok, remaining: c.remaining, metered: true, reason: c.reason };
}
