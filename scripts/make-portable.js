const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const releaseDir = path.join(root, 'release');
const src = path.join(releaseDir, 'win-unpacked');
const stage = path.join(releaseDir, '.portable-stage');
const appDir = path.join(stage, 'VideoDownloader');
const out = path.join(releaseDir, `VideoDownloader-${version}-portable.zip`);

if (!fs.existsSync(src)) {
  console.error('找不到 release/win-unpacked，请先运行 npm run dist（或 npm run pack）。');
  process.exit(1);
}

console.log('准备免安装包（清理暂存）…');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

console.log('复制 win-unpacked → VideoDownloader …');
fs.cpSync(src, appDir, { recursive: true });

console.log('压缩为 zip …');
fs.rmSync(out, { force: true });
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${appDir}' -DestinationPath '${out}' -CompressionLevel Optimal -Force"`,
  { stdio: 'inherit' }
);

fs.rmSync(stage, { recursive: true, force: true });
console.log('已生成免安装包:', out);
