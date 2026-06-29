#!/bin/bash
# 下载 yt-dlp ARM64 独立二进制 和 ffmpeg ARM64 到 assets/
# 用法：在项目根目录运行 bash android/get-bins.sh

set -e
ASSETS="android/app/src/main/assets"
mkdir -p "$ASSETS"

echo "=== 下载 yt-dlp ARM64 ==="
# yt-dlp nightly 的 linux_aarch64 二进制
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
curl -L -o "$ASSETS/ytdlp_arm64" "$YTDLP_URL"
chmod +x "$ASSETS/ytdlp_arm64"

echo "=== 下载 ffmpeg ARM64 ==="
# 使用预编译静态 ffmpeg (来自 GitHub)
FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-arm64"
curl -L -o "$ASSETS/ffmpeg_arm64" "$FFMPEG_URL"
chmod +x "$ASSETS/ffmpeg_arm64"

echo "=== 完成 ==="
ls -lh "$ASSETS/"
