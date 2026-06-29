# 视频下载器 —— 交接文档（HANDOFF）

> **当前版本：v1.0.1**
>
> 桌面视频下载器（哔哩哔哩 / YouTube），Electron + TypeScript + yt-dlp。
> 带服务器端授权：授权码 + 设备绑定（1 台）+ 到期控制 + Ed25519 签名防伪。
> **自助充值**：XorPay 微信/支付宝扫码 → 自动发码 → 用户激活。
> 服务器已用 Docker + Nginx + Let's Encrypt(HTTPS) 部署在 **`8.140.249.127`**（公网仅走 443, Nginx 反代到本地 8090）。
>
> 日常"改代码 → 打包 → 上传 → 部署"的具体操作步骤见 **`OPERATIONS.md`**。

---

## 1. 总览

- **客户端**：发给最终用户的 Windows 安装版 / 免安装版。**解析 + 网页预览免费；点"下载"时才提示激活**（freemium）。用户可通过自助充值页面付钱获得授权码；也可以在后台手动获得（发给朋友 / 手动处理订单）。
- **服务器**：你自有阿里云服务器，跑 Docker 容器（授权验证 + 自助充值 + 网页管理后台）。你在后台发码 / 改到期 / 停用 / 按设备码查状态。**客户自己通过 `/recharge` 微信/支付宝扫码付钱后自动拿到授权码，你再也不用手动发码**。
- **两者关系**：客户端启动时校验授权（验证 /verify、扣次 /consume）。服务器用 Ed25519 私钥签名应答，客户端用内置公钥验签。**授权码 = XorPay 通道流水号（微信订单号 / 支付宝订单号）== 客户永久可查的支付凭证**。

---

## 2. 目录结构

```
videodownloader/
├─ src/                      客户端源码（TypeScript）
│  ├─ main.ts                主进程：窗口、IPC、授权门禁、Cookie 协调、扣次/退回
│  ├─ preload.ts             安全桥
│  ├─ downloader.ts          yt-dlp 封装：解析/下载/进度/画质/加速/抖音禁用开关
│  ├─ cookies.ts             B站/YouTube 自动取 Cookie + 应用内登录窗口
│  ├─ license.ts             ★授权：设备指纹、联网验签/扣次/宽容期、服务器地址/公钥
│  ├─ constants.ts           ★UA、DOUYIN_ENABLED 开关
│  └─ renderer/              界面 index.html / styles.css / renderer.ts
├─ server/                   ★服务器（部署到你的阿里云）
│  ├─ server.js              Express 服务：/verify /consume /refund /pay-callback /order/* /admin/*
│  ├─ public/admin.html      网页管理后台
│  ├─ public/recharge.html   自助充值页面
│  ├─ docker-compose.yml     ★容器编排（重启策略、端口、令牌、密钥、套餐定义）
│  ├─ Dockerfile             镜像构建
│  ├─ nginx-license.conf     Nginx 反代配置模板
│  ├─ genkeys.js             生成 Ed25519 密钥对
│  ├─ private.pem            ★签名私钥（只放服务器；不打进镜像，只读挂载进去）
│  └─ public.pem             公钥（与客户端内置的相同，备查）
├─ scripts/                  构建脚本（copy-assets、make-portable）
├─ release/                  打包产物（安装包 / 免安装包 / 服务部署包）
├─ payinfo/                  XorPay 密钥(只存本地参考，部署用 compose 的 XORPAY_APP_ID/SECRET 环境变量)
└─ key/starluck.pem          阿里云 SSH 登录私钥（与授权无关，仅登录用）
```

★ = 需要重点关注的文件。

---

## 3. 客户端

### 3.1 构建 / 运行 / 打包
```bash
npm install        # 首次
npm start          # 开发运行
npm run release    # 一键出安装包 + 免安装包（= npm run dist && npm run portable）
```
产物在 `release/`：
- `VideoDownloader Setup 1.0.1.exe`——安装版
- `VideoDownloader-1.0.1-portable.zip`——免安装版（解压得 `VideoDownloader\` 文件夹，双击 exe 即用）

### 3.2 运行时说明
- 版本号：根 `package.json` 的 `version`（当前 1.0.1）。
- **yt-dlp**：不打包，首次运行自动下载到 `%APPDATA%\videodownloader\bin`（首次需联网）。
- **ffmpeg**：已打包（ffmpeg-static, asarUnpack）。
- **aria2c**：可选，装了就多线程加速。
- 画质优先 **H.264 + AAC**（兼容性最好）。

### 3.3 站点现状
| 站点 | 状态 | 说明 |
|------|------|------|
| 哔哩哔哩 | ✅ | 用"应用内登录 B站"一次 |
| YouTube | ✅ | 公开视频免登录；受限内容用浏览器 cookie |
| 抖音 | ⛔ 已禁用 | yt-dlp 上游反爬。开关在 `src/constants.ts` 的 `DOUYIN_ENABLED` |

### 3.4 价格 / 模式
- **免费**：解析 + 网页预览（一键浏览器打开原始网页观看）
- **需激活**：点"开始下载" → 未授权时弹出授权码输入框，输入后即可无限下载（不限次的码）或按次控量（限次的码）
- **渠道**：客户可以在自助充值页自己付钱 → 自动获得授权码

---

## 4. 服务器（HTTPS, Docker, Nginx, Let's Encrypt）

### 4.1 运行方式
Docker + `docker-compose.yml`。容器 `restart: always`。
- 端口：8090 **只绑服务器本机回环**(`127.0.0.1`)，公网全部走 Nginx 443 (HTTPS)
- 证书：Let's Encrypt，自动续期(`certbot`)
- 域名：**`license-videodownload.justsaysayforfun.com`**

### 4.2 环境变量（在 `docker-compose.yml` 里）
| 变量 | 说明 |
|------|------|
| `ADMIN_TOKEN` | 后台登录令牌 |
| `ADMIN_PATH` | 后台秘密路径（默认 `console-change-me-9f3a2x7k`） |
| `XORPAY_APP_ID` / `XORPAY_APP_SECRET` | XorPay 支付密钥 |
| `BASE_URL` | 本站 HTTPS 地址，用来构造 XorPay 回调地址 |
| `PORT` | 默认 8090 |
| `MAX_DEVICES` | 每码绑定设备数，默认 1 |
| `LICENSES_PATH` / `ORDERS_PATH` | 数据文件路径(Docker 里固定挂到 `/data`) |
| `PACKAGES` | JSON 字符串，定义充值套餐（改完 `docker compose up -d --build` 生效） |

### 4.3 接口一览
| 方法 | 路径 | 鉴权 | 用途 |
|------|------|------|------|
| GET | `/` | 无 | 健康检查 |
| POST | `/verify` | 无(Ed25519 签名) | 客户端校验 |
| POST | `/consume` | 无(签名) | 客户端扣次 |
| POST | `/refund` | 无(签名) | 下载失败退回次数 |
| GET | `/<ADMIN_PATH>` | 无(页面) | 管理后台页面 |
| GET/POST | `/admin/*` | x-admin-token + 限流 | 管理 API |
| GET | `/recharge` | 无(页面) | 自助充值页 |
| GET | `/order/packages` | 无 | 返回可选套餐 |
| POST | `/order/create` | 无 | 创建支付订单 |
| GET | `/order/status?orderId=` | 无 | 轮询订单状态/获取授权码 |
| POST | `/pay-callback` | XorPay 验签 | 支付异步通知 |
| GET | `/status.json` | 无 | 全局遥控开关(kill-switch) |
| GET | `/<ADMIN_PATH>` | 无(页面) | 管理后台页面 |
**不是数据库**,就是两个 JSON 文件,都在 Docker 宿主的 `./data/` 卷里：
| 文件 | 用途 |
|------|------|
| `/root/vd-license/data/licenses.json` | 授权码记录(含来源/到期/次数/设备) |
| `/root/vd-license/data/orders.json` | 支付订单记录(含 XorPay aoid/txnId/套餐/金额/状态) |
```bash
cat /root/vd-license/data/licenses.json | python3 -m json.tool
cat /root/vd-license/data/orders.json | python3 -m json.tool
cp /root/vd-license/data/licenses.json ~/backups/licenses-$(date +%F).json  # 备份
```

---

## 5. 网页后台（`https://域名/<ADMIN_PATH>`）

用 `ADMIN_TOKEN` 登录（明文框,浏览器会记住令牌并自动加载列表）。功能：
- **生成授权码**：填数量 / 有效期天数 / 备注 → 得到 `VD-XXXX-XXXX-XXXX` 发给客户（来源标 "手动"）
- **列表列**（授权码→设备码→到期→状态→已绑定设备→次数→**来源**→备注→操作）：手动发的来源显示"手动",自助充值的显示"自助充值(日期)"
- **操作按钮**：+30天/+1年/设到期日、**设次数/重置已用**、停用/启用、重置设备(换机)
- **按设备码查询**

---

## 6. 自助充值（`/recharge`）

### 6.1 客户流程
1. 打开 `/recharge` → 选套餐 → 选微信/支付宝 → "确认购买"
2. 扫码付款 → 页面自动弹窗：**授权码（即微信/支付宝通道流水号）+ 复制按钮 + 永久可查提示**
3. 复制授权码 → 去桌面软件"激活" → 下载

### 6.2 防丢失
授权码就是**微信/支付宝的支付流水号**（20 位数字），这个码永久保存在：
- 微信：我 → 服务 → 钱包 → 账单
- 支付宝：我的 → 账单

用户付完钱，这个码永不丢失，即使关闭页面也能在支付 App 账单里找到。

### 6.3 套餐配置
在 `docker-compose.yml` 的 `PACKAGES` 环境变量里直接改 JSON，改完 `docker compose up -d --build` 即生效。当前套餐：

| ID | 名称 | 价格 | 天数 |
|----|------|------|------|
| monthly | 月度套餐 | ¥15.9 | 30天 |
| quarterly | 季度套餐 | ¥39.9 | 90天 |
| halfyear | 半年套餐 | ¥70 | 180天 |
| yearly | 年度套餐 | ¥99.9 | 365天 |

> 如需加下载次数限制，给套餐加 `"quota": N` 字段（可随时改）。

---

## 7. 授权码的"来源"

每条授权码 JSON 里多了一个 `source` 字段（`manual` / `recharge`），以及可选的 `orderId`。

- **手动**(后台"生成授权码")：格式 `VD-XXXX-XXXX-XXXX`
- **自助充值**：授权码就是通道流水号（长数字，如 `920704...`），也是订单号。后台列表"来源"列会显示"自助充值 + 创建日期"。

---

## 8. ★ 关键约束（必读）

- 服务器上的 `private.pem` 必须和客户端内置的 Ed25519 公钥是**同一对**。部署时用随包带来的 `private.pem`,不要重新生成。
- **改变域名/IP/端口** → 需要改客户端 `src/license.ts` 的 `SERVER_URL`，重新 `npm run release` 并重新分发客户端。
- `ADMIN_TOKEN` 要强随机、`ADMIN_PATH` 要不可猜 —— 都在 compose 里随时改。
- **XorPay 密钥**存在 compose 里,运行时不依赖 `payinfo/` 文件夹。

---

## 9. 已知问题 / 提醒

- **未代码签名**：用户首次运行弹 SmartScreen → "更多信息 → 仍要运行"。
- **防破解**：Ed25519 签名能挡伪造服务器响应；Electron 本地程序重度用户可改包绕过，非军用级。
- **抖音**：上游禁止，已禁用。
- **私钥安全**：`server/private.pem`、`key/starluck.pem` 已 gitignore，勿外泄。
- **打包符号链接**：换机打包若报 `Cannot create symbolic link`，开 Windows 开发者模式或以管理员运行终端。

---

## 10. 命令速查
```bash
# 客户端
npm start                     # 开发运行
npm run release               # 出安装包 + 免安装包

# 服务器打包（生成 release/server-deploy.tar.gz）
tar -czf release/server-deploy.tar.gz -C server --exclude=node_modules --exclude=data .
```
详细操作步骤、部署更新方法见 **`OPERATIONS.md`**。

---

## 11. GitHub 分支

| 分支 | 内容 |
|------|------|
| `main` | 免费版 v1.1.0(桌面版,Electron) |
| `globalControlVersion` | 免费版 + kill-switch(遥控关闭) |
| `apk` | 同上 + Android Kotlin/Compose 完整工程 + Chaquopy(Python+yt-dlp) |

## 12. Android (APK) 分支状态 ⚠️ 进行中

### 已完成
- Kotlin + Jetpack Compose 完整 UI(URL 输入/解析/画质/下载列表)
- Chaquopy 集成(Python 3.14 + yt-dlp pip 安装 → bionic 原生兼容)
- YouTube WebView 登录(读 SQLite Cookie 数据库→ 27 条 Cookie 已通)
- Kill-switch(和桌面版共享 `status.json`)
- APK 构建通过(`./gradlew assembleRelease` → ~110MB)

### ⚠️ 卡住:YouTube 下载格式报错
**现象**:`ERROR: Requested format is not available`
**根因**:YouTube 对不同客户端(web/android/ios)返回**不同的格式子集**。桌面版用 yt-dlp standalone binary(默认 web client)→ 完整 DASH 格式列表→ `bv*+ba/b` 能匹配。Chaquopy 环境下的 yt-dlp 可能默认用了 Android client→ 返回精简格式列表→ `bv*`/`bestvideo*` 找不到匹配。

**已尝试(均无效)**:
- `bv*+ba/b`、`best`、`18/best`、`bestvideo*+bestaudio/best` 多种格式串
- `player_client: web/ios/android` + `player_skip: []` 强制客户端
- `--upgrade yt-dlp` 最新版 + `extractPackages`
- 桌面版全套参数 `-S vcodec:h264,res,acodec:aac` + `merge_output_format mp4`
- 桌面 UA `Chrome/124 ... Windows NT 10.0`
- 三层兜底 `/b/best` 链式格式

**当前代码(apk 分支)**:`android/app/src/main/python/downloader.py` 已含桌面版完整参数 + 三层兜底。**下次尝试方向**:`--list-formats` 对比 PC/Android 两端实际返回的格式 ID 差异,根据 Android 端实际可用的 format_id 定制选择器。

## 13. APK 构建速查

```bash
cd android
./gradlew assembleRelease
# 产物: app/build/outputs/apk/release/app-release-unsigned.apk
# 签名: apksigner sign --ks debug.keystore ...
```

yt-dlp + ffmpeg 二进制需预放 `app/src/main/assets/`:
- `ytdlp_arm64`(Chaquopy 已替代,不需要)
- `ffmpeg_arm64`(bionic ARM64,47.7MB,当前是 glibc 版→需替换为 Termux/Android 原生编译版)

详见 `android/README.md`。
