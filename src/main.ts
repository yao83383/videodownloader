import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { Downloader, DownloadRequest, ProgressData, CookieOpts } from './downloader';
import { harvestCookies, siteKey, openLoginWindow, siteHome } from './cookies';
import { computeStatus, activate, beginDownload, refund } from './license';

let mainWindow: BrowserWindow | null = null;
let downloader: Downloader;
let readyPromise: Promise<void>;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 680,
    minHeight: 520,
    title: 'Video Downloader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const AUTO_COOKIE_MAX_AGE_MS = 3 * 60 * 1000;
const COOKIE_REQUIRED = new Set(['bilibili', 'douyin']);



function isFresh(file: string): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < AUTO_COOKIE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function resolveCookies(url: string, opts?: CookieOpts): Promise<CookieOpts | undefined> {
  if (opts && (opts.cookiesFile || opts.cookiesFromBrowser)) return opts;

  const key = siteKey(url);
  if (!key) return opts;

  const cookieDir = path.join(app.getPath('userData'), 'cookies');
  fs.mkdirSync(cookieDir, { recursive: true });
  const out = path.join(cookieDir, `${key}.txt`);

  // Optional-cookie sites (e.g. YouTube): only use cookies if the user has logged in before.
  if (!fs.existsSync(out) && !COOKIE_REQUIRED.has(key)) return opts;

  if (!isFresh(out)) {
    send('app:status-text', `正在自动获取 ${key} Cookie…`);
    try {
      await harvestCookies(url, out);
    } catch {
      // ignore; fall back to whatever exists or no cookies
    }
  }

  return fs.existsSync(out) ? { ...opts, cookiesFile: out } : opts;
}

function registerIpc(): void {
  ipcMain.handle('app:get-default-dir', () => app.getPath('downloads'));

  ipcMain.handle('app:select-dir', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle('app:get-status', async () => {
    try {
      await readyPromise;
      return { ready: true, aria2c: downloader.aria2cAvailable };
    } catch (err: any) {
      return { ready: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('app:get-license', async () => computeStatus());

  ipcMain.handle('app:activate-license', async (_e, key: string) => activate(key));

  ipcMain.handle('app:update-ytdlp', async () => {
    await readyPromise;
    try {
      const message = await downloader.updateBinary();
      return { ok: true, message };
    } catch (err: any) {
      return { ok: false, message: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('app:login', async (_e, site: string) => {
    await openLoginWindow(site);
    // 根据 site 字符串推导站点 key（bilibili/douyin/youtube/netease/kugou/qqmusic）
    const siteUrl =
      site === 'douyin' ? 'https://douyin.com' :
      site === 'youtube' ? 'https://youtube.com' :
      site === 'netease' ? 'https://music.163.com' :
      site === 'kugou' ? 'https://kugou.com' :
      site === 'qqmusic' ? 'https://y.qq.com' :
      'https://bilibili.com';
    const key = siteKey(siteUrl) || 'bilibili';
    const cookieDir = path.join(app.getPath('userData'), 'cookies');
    fs.mkdirSync(cookieDir, { recursive: true });
    const out = path.join(cookieDir, `${key}.txt`);
    try {
      await harvestCookies(siteHome(key), out);
    } catch {
      // ignore
    }
    return true;
  });

  ipcMain.handle('app:get-video-info', async (_e, url: string, opts?: CookieOpts) => {
    await readyPromise;
    const resolved = await resolveCookies(url, opts);
    return downloader.getVideoInfo(url, resolved);
  });

  ipcMain.handle('app:select-cookies-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt'] }],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle('app:start-download', async (_e, req: DownloadRequest) => {
    await readyPromise;
    const gate = await beginDownload();
    if (!gate.ok) throw new Error(gate.reason || '无法下载');
    const resolved = await resolveCookies(req.url, req);
    const merged: DownloadRequest = { ...req, ...resolved };
    let refunded = false;
    return downloader.startDownload(merged, (p: ProgressData) => {
      send('download:progress', { ...p, remaining: gate.remaining });
      if (p.status === 'error' && gate.metered && !refunded) {
        refunded = true;
        refund().catch(() => undefined);
      }
    });
  });

  ipcMain.handle('app:open-path', async (_e, target: string) => {
    if (!target) return;
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        await shell.openPath(target);
      } else {
        shell.showItemInFolder(target);
      }
    } catch {
      await shell.openPath(path.dirname(target));
    }
  });

  ipcMain.handle('app:open-external', async (_e, url: string) => {
    if (url) await shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  downloader = new Downloader(path.join(app.getPath('userData'), 'bin'));
  readyPromise = downloader.init();
  readyPromise
    .then(() => send('app:status', { ready: true, aria2c: downloader.aria2cAvailable }))
    .catch((err: Error) => send('app:status', { ready: false, error: err.message }));

  registerIpc();
  createWindow();
  computeStatus().catch(() => undefined);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
