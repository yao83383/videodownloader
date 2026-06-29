# 运维操作手册（OPERATIONS）

> **面向"维护者"的日常操作**: 改代码 → 编译 → 打包 → 上传 → 部署。
> 配套总览见 `HANDOFF.md`。
>
> | 项目 | 信息 |
> |------|------|
> | 服务器 IP | `8.140.249.127`（阿里云 ECS） |
> | SSH 私钥 | `key\starluck.pem` |
> | 服务目录 | `/root/vd-license` |
> | HTTPS | `https://license-videodownload.justsaysayforfun.com` |
> | 后台 | `https://域名/<ADMIN_PATH>`(秘密路径, compose 里定义) |
> | 充值页 | `https://域名/recharge` |
> | 数据 | `/root/vd-license/data/`（licenses.json + orders.json） |
> | 版本 | 1.0.1 |

---

## 0. 初始化（构建机器，一次性）

- 装 **Node.js 18+**（含 npm）。
- 在项目根目录 `npm install`。
- 确认 `key\starluck.pem` 存在（SSH 登录用）。
- Windows 自带 `scp`、`tar`（Win10+）。

> 以下假设项目根目录为 `E:\Projs\videodownloader`（PowerShell）。

---

## 一、客户端：改代码 → 打包 → 发给用户

```powershell
cd E:\Projs\videodownloader
npm run release
```
产物在 `release/`：
- `VideoDownloader Setup 1.0.1.exe` — 安装版
- `VideoDownloader-1.0.1-portable.zip` — 免安装版

发给用户即可。首次运行需联网（下载 yt-dlp + 联网校验授权 / 扣次）。可能弹 SmartScreen → "更多信息 → 仍要运行"。

> **改版本号**: 编辑根 `package.json` 的 `"version"`，再 `npm run release`。

### ⚠️ 换一台电脑打包时的常见坑

- **打包报 `Cannot create symbolic link ... winCodeSign`** → 开启 Windows **设置 → 开发者选项(开发者模式)**，或以**管理员身份**运行终端，再 `npm run release`。

- **scp 报 `Bad permissions / UNPROTECTED PRIVATE KEY`** → 需要缩紧 `starluck.pem` 权限（做一次即可）:
  ```powershell
  icacls "key\starluck.pem" /inheritance:r
  icacls "key\starluck.pem" /grant:r "$($env:USERNAME):R"
  ```

---

## 二、服务器：改代码 → 打包 → 上传 → 部署

> 适用于改了 `server/server.js`、`public/admin.html`、`public/recharge.html`、`docker-compose.yml` 等。

### 2.1 在构建机生成部署包
```powershell
cd E:\Projs\videodownloader
tar -czf "release\server-deploy.tar.gz" -C server --exclude=node_modules --exclude=data .
```

### 2.2 上传到服务器
```powershell
scp -i key\starluck.pem "release\server-deploy.tar.gz" root@8.140.249.127:/root/
```

### 2.3 服务器上解压 + 重建容器
SSH 登录后：
```bash
tar -xzf /root/server-deploy.tar.gz -C /root/vd-license
cd /root/vd-license
docker compose up -d --build
```

### 2.4 验证
```bash
docker compose ps                  # status = Up
docker compose logs --tail=30      # 看日志
curl https://127.0.0.1/ -k         # 应返回 OK（因访问 localhost 需带 -k 跳过证书）
```
再浏览器开 `https://license-videodownload.justsaysayforfun.com/` 和 `/recharge`、后台路径。

### 2.5 套餐 / 价格更改
编辑 `docker-compose.yml` 的 `PACKAGES` 环境变量（JSON 数组），然后：
```bash
cd /root/vd-license && docker compose up -d --build
```
刷新 `/recharge` 即可看到新套餐。**不需要改代码。**

---

## 三、日常后台管理

1. 打开后台路径（`https://域名/<ADMIN_PATH>`），输入 `ADMIN_TOKEN`（浏览器会记住）。
2. **发码（手动）**：填数量 / 有效期天数 / 备注 → "生成授权码" → 复制 `VD-XXXX-XXXX-XXXX` 给客户。
3. **续期**：+30天 / +1年 / 设到期日。
4. **收回（停用）**：点"停用"，客户下次联网即锁。
5. **换机**：点"重置设备"清除绑定。
6. **次数控制**（后台生成时填次数；充值时套餐里定；设次数 / 重置已用可后手修改）。
7. **按设备码查询**：从客户发的"设备码"查出授权码 / 到期 / 来源 / 状态。

---

## 四、支付 / 自助充值业务流程

### 4.1 客户流程
1. 打开 `https://域名/recharge`
2. 选套餐 → 选微信/支付宝 → "确认购买"
3. 扫码付 → 页面自动弹出授权码（**微信/支付宝通道流水号**）+ 复制按钮
4. 去桌面软件"激活" → 输入此码 → 右上角显示到期日 / 剩余次数
5. **即使关闭页面**，此码永久保存在微信 / 支付宝账单里，永不丢失

### 4.2 订单 / 售后查询
- 客户报一串数字（微信/支付宝流水号）→ 你在后台列表 `licenses.json` 里搜这个号，或在 `orders.json` 里搜。
- XorPay 后台同样可查（`xorpay.com/main`）：用 `aoid` / `order_id` 查订单、金额、时间。
- 两种记录（授权码 / 订单）互相关联：`licenses.json` 里每条自助充值的授权码有 `orderId` 和 `source:'recharge'`。

### 4.3 支付异常处理
- "下单失败"→ 查 `docker compose logs` 里 XorPay 返回的状态（`sign_error` / `fee_error` / `app_off` 等），按 XorPay 后台指引处理。
- 付了钱页面没反应 → 看 docker 里 `/pay-callback` 是否被调、sign 是否正确。XorPay 会自动重试（最多 6 次、间隔 1/2/4/16/64/300 分钟）。
- XorPay 账户余额不足 → 去 `xorpay.com/main` 充值。

---

## 五、首次部署 / 换新服务器（Docker + Nginx + HTTPS）

> 仅当迁到全新服务器或从零部署时参考。

```bash
# 1) 服务器装 Docker
docker --version || (curl -fsSL https://get.docker.com | bash)
systemctl enable --now docker

# 2) 上传并解压（构建机执行 scp,见上文）
mkdir -p /root/vd-license
tar -xzf /root/server-deploy.tar.gz -C /root/vd-license
cd /root/vd-license

# 3) 修改 docker-compose.yml 的 ADMIN_TOKEN / ADMIN_PATH（强随机）

# 4) 启动容器
docker compose up -d --build

# 5) 安装 Nginx + 配置反代
yum install -y nginx || apt install -y nginx
systemctl enable --now nginx
cp /root/vd-license/nginx-license.conf /etc/nginx/conf.d/license.conf
nginx -t && systemctl reload nginx

# 6) certbot 签发 HTTPS
yum install -y certbot python3-certbot-nginx || apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名
# 按提示填邮箱, 选 redirect (自动跳转 HTTPS)

# 7) 阿里云安全组放行 80/443
```

> ★★ 必须用随包带来的 `private.pem`；不要在服务器跑 `npm run genkeys`。

---

## 六、备份与恢复

- **备份（最重要）**:
  ```bash
  cp /root/vd-license/data/licenses.json ~/backups/licenses-$(date +%F).json
  cp /root/vd-license/data/orders.json ~/backups/orders-$(date +%F).json
  cp /root/vd-license/private.pem ~/backups/private.pem
  ```
- **恢复**: 把备份的文件放回 `vd-license/data/`，`docker compose restart`。

---

## 七、常见问题排查

| 现象 | 原因 / 处理 |
|------|-------------|
| 浏览器 `ERR_CONNECTION_REFUSED` | 容器没起 / nginx 没开。`docker compose ps`；`systemctl status nginx` |
| Nginx 50x / 502 | 容器在跑但 nginx 连不上。检查 8090 是否只绑了 127.0.0.1；`docker compose logs` |
| 后台提示 "管理员令牌错误" | 输入的令牌 ≠ compose 里的 `ADMIN_TOKEN` |
| 客户端卡激活 | 服务器没起,或授权码无效/过期/换设备 |
| 安卓/外网能开充值页但回调不触发 | 检查 `BASE_URL` 是否是 HTTPS 公网域名；XorPay 回调用的是公网可达地址 |
| 打包 winCodeSign 报错 | 开 Windows 开发者模式,或以管理员运行终端 |
| 证书快到期 | certbot 自动续期(一般不用管)；手动续: `certbot renew --force-renewal` |

---

## 八、遥控关闭 / 开放服务（kill-switch）

> 一键关掉所有正在使用的客户端,或重新放行。不需要重启 Docker,不需要重打包客户端。

### 关掉所有客户端
SSH 登录服务器后:
```bash
echo '{"ok":false,"msg":"软件已停止服务，感谢使用"}' > /root/vd-license/data/status.json
```
所有在线客户端在 **6 小时内**陆续被锁(解析和下载均被拦截,顶部显示"软件已停止服务,感谢使用")。

### 重新开放
```bash
rm /root/vd-license/data/status.json
```
文件不存在 = 放行。客户端在 6 小时内恢复使用。

### 查看当前状态
```bash
cat /root/vd-license/data/status.json
```
- 显示 `{"ok":false,...}` → 当前已关闭
- 显示 `{"ok":true}` → 开放中
- 文件不存在 → 开放中(默认)

### 说明
- 改文件即生效,不需要重启 Docker、不需要重打包客户端
- 客户端每 **6 小时**静默检查一次
- 断网用户不受影响(无网时不追责)
- `status.json` 放在 Docker 数据卷的 `/data/` 内,与 `licenses.json` 同一目录

---
## 九、Android APK 构建与调试

### 构建
```bash
cd android && ./gradlew assembleRelease
# 签名:
$ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --out app-release.apk app-release-unsigned.apk
```

### 当前卡住的问题
YouTube 下载报 `Requested format is not available`。根因:Chaquopy 环境下的 yt-dlp 拿到的格式列表**与桌面版(web client)不同**(Android client 返回精简格式子集)。桌面版 `bv*+ba/b` 选择器在这些精简格式中找不到匹配。

**调试思路**:
1. 在 downloader.py 里加一行日志,打印 `list(f["format_id"] for f in info["formats"])`
2. 对比 Android 和 PC 实际拿到的 format_id 列表差异
3. 根据差异定制 Android 专用格式选择器(或修复 Chaquopy 环境使 yt-dlp 返回完整格式)

详细状态见 `HANDOFF.md` 第 12 节。

### 服务器常用 Docker 命令
```bash
docker compose -f /root/vd-license/docker-compose.yml ps
docker compose -f /root/vd-license/docker-compose.yml logs -f
docker compose -f /root/vd-license/docker-compose.yml up -d --build
docker compose -f /root/vd-license/docker-compose.yml restart
docker compose -f /root/vd-license/docker-compose.yml down
```
