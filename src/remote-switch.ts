import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { app } from 'electron';

const STATUS_URL = 'https://license-videodownload.justsaysayforfun.com/status.json';
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 小时

let blocked = false;
let blockMsg = '';
let lastCheck = 0;

function cachePath(): string {
  return path.join(app.getPath('userData'), 'switch-cache.json');
}

function loadCache(): { ok: boolean; msg: string; checkedAt: number } | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(ok: boolean, msg: string): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify({ ok, msg, checkedAt: Date.now() }), 'utf8');
  } catch {
    /* ignore */
  }
}

function fetchUrl(urlStr: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(urlStr); } catch { return reject(new Error('bad-url')); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, timeout: timeoutMs },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function checkSwitch(): Promise<void> {
  try {
    const raw = await fetchUrl(STATUS_URL);
    const data = JSON.parse(raw);
    const ok = data.ok !== false;
    const msg = data.msg || '';
    blocked = !ok;
    blockMsg = blocked ? msg : '';
    saveCache(ok, msg);
    lastCheck = Date.now();
  } catch {
    // 网络失败时读缓存；无缓存则放行（宽容离线用户）
    const c = loadCache();
    blocked = c ? !c.ok : false;
    blockMsg = (c && !c.ok) ? (c.msg || '') : '';
    lastCheck = c ? c.checkedAt : 0;
  }
}

export function isBlocked(): boolean {
  return blocked;
}

export function getBlockMessage(): string {
  return blockMsg || '软件已停止服务，感谢使用';
}
