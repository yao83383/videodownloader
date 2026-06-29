# 口语听力素材学习辅助工具 — Android (APK) 版本

## 0. 准备

- Android Studio Hedgehog+ 或命令行 `sdkmanager` + `gradle`
- Android SDK 34
- **yt-dlp ARM64 二进制**: 运行 `bash android/get-bins.sh` 下载到 `assets/`
- **ffmpeg ARM64 二进制**: 同上脚本下载
- 也可自行准备: 把 `yt-dlp_linux_aarch64` 重命名为 `ytdlp_arm64`，把 `ffmpeg-linux-arm64` 重命名为 `ffmpeg_arm64`，放到 `android/app/src/main/assets/`

## 1. 构建 APK

```bash
cd android
./gradlew assembleRelease
```
产物在 `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## 2. 签名(本地测试)

```bash
keytool -genkey -v -keystore debug.keystore -alias debug -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android

# 在 app/build.gradle.kts 的 android 块内加上:
# signingConfigs { create("release") { storeFile = file("debug.keystore"); storePassword = "android"; keyAlias = "debug"; keyPassword = "android" } }
# 并在 buildTypes.release 里: signingConfig = signingConfigs.getByName("release")

./gradlew assembleRelease
```

## 3. 安装到手机

```bash
adb install app/build/outputs/apk/release/app-release.apk
```

## 4. 分发

生成的 APK 约 80-120 MB(含 yt-dlp + ffmpeg 二进制)。可直接把 APK 文件发给用户或用 GitHub Release 挂附件。

## 5. 遥控关闭(kill-switch)

与桌面版共用同一 `status.json`。服务端操作见 `../OPERATIONS.md` 第八章。

## 6. 项目结构

```
android/
├── app/src/main/
│   ├── assets/ytdlp_arm64       ← yt-dlp ARM64 二进制(需手动下载)
│   ├── assets/ffmpeg_arm64      ← ffmpeg ARM64 二进制(需手动下载)
│   ├── java/com/starluck/downloader/
│   │   ├── MainActivity.kt      Compose 主界面
│   │   ├── YtDlpRunner.kt       yt-dlp 进程调用 + 进度解析
│   │   ├── DownloadService.kt   前台服务
│   │   └── RemoteSwitch.kt      kill‑switch 检测
│   ├── res/values/              字符串/主题
│   └── AndroidManifest.xml
├── app/build.gradle.kts
├── build.gradle.kts
├── settings.gradle.kts
└── get-bins.sh                   下载 yt-dlp/ffmpeg 二进制
```
