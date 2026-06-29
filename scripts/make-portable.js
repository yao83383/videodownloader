const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const releaseDir = path.join(root, 'release');
const src = path.join(releaseDir, 'win-unpacked');
const stage = path.join(releaseDir, '.portable-stage');
const appDir = path.join(stage, 'VideoDownloader');

if (!fs.existsSync(src)) {
  console.error('找不到 release/win-unpacked，请先运行 npm run dist（或 npm run pack）。');
  process.exit(1);
}

console.log('准备免安装包（清理暂存）…');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

console.log('复制 win-unpacked → VideoDownloader …');
fs.cpSync(src, appDir, { recursive: true });

// 优先用 7-Zip（体积小 35%），没有就用 tar.gz
const tarOut = path.join(releaseDir, `VideoDownloader-${version}-portable.tar.gz`);
const z7Out = path.join(releaseDir, `VideoDownloader-${version}-portable.7z`);
const sevenZip = path.join(root, 'node_modules', '7zip-bin', process.platform === 'win32' ? 'win\\x64\\7za.exe' : 'linux\\x64\\7za');

try {
  console.log('用 7-Zip 压缩（体积最小）…');
  fs.rmSync(z7Out, { force: true });
  execSync(`"${sevenZip}" a -t7z -mx=9 -myx=9 -mfb=273 -ms=on "${z7Out}" "${appDir}"`, { stdio: 'inherit' });
  console.log('已生成:', z7Out);
} catch (e) {
  // 7-Zip 不可用时回落
  console.error('7-Zip 调用失败，改用 tar.gz 压缩 …', e.message);
  fs.rmSync(tarOut, { force: true });
  try {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${appDir}' -DestinationPath '${tarOut}' -CompressionLevel Optimal -Force"`, { stdio: 'inherit' });
    console.log('已生成（zip）:', tarOut);
  } catch (e2) {
    console.error('打包失败:', e2.message);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
