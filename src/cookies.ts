import fs from 'fs';
import { BrowserWindow, session } from 'electron';
import { USER_AGENT } from './constants';

const PARTITION = 'persist:autocookie';

export function siteKey(url: string): string | null {
  if (/bilibili\.com|b23\.tv/i.test(url)) return 'bilibili';
  if (/douyin\.com|iesdouyin\.com/i.test(url)) return 'douyin';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/music\.163\.com/i.test(url)) return 'netease';
  if (/kugou\.com/i.test(url)) return 'kugou';
  if (/y\.qq\.com/i.test(url)) return 'qqmusic';
  return null;
}

export function siteHome(key: string): string {
  if (key === 'douyin') return 'https://www.douyin.com/';
  if (key === 'youtube') return 'https://www.youtube.com/';
  if (key === 'netease') return 'https://music.163.com/';
  if (key === 'kugou') return 'https://www.kugou.com/';
  if (key === 'qqmusic') return 'https://y.qq.com/';
  return 'https://www.bilibili.com/';
}

const LOGIN_TITLE: Record<string, string> = {
  bilibili: '登录哔哩哔哩（登录完成后关闭本窗口）',
  douyin: '登录抖音（登录完成后关闭本窗口）',
  youtube: '登录 YouTube（登录完成后关闭本窗口）',
  netease: '登录网易云音乐（登录完成后关闭本窗口）',
  kugou: '登录酷狗音乐（登录完成后关闭本窗口）',
  qqmusic: '登录 QQ 音乐（登录完成后关闭本窗口）',
};

export function openLoginWindow(site: string): Promise<void> {
  const key = siteKey('https://' + (site === 'bilibili' ? 'bilibili.com' : site === 'douyin' ? 'douyin.com' : site === 'youtube' ? 'youtube.com' : site === 'netease' ? 'music.163.com' : site === 'kugou' ? 'kugou.com' : site === 'qqmusic' ? 'y.qq.com' : 'bilibili.com')) || 'bilibili';
  const win = new BrowserWindow({
    width: 1024,
    height: 760,
    title: LOGIN_TITLE[key] || LOGIN_TITLE.bilibili,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION },
  });
  win.webContents.setUserAgent(USER_AGENT);
  win.loadURL(siteHome(key), { userAgent: USER_AGENT }).catch(() => undefined);
  return new Promise((resolve) => {
    win.on('closed', () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAndSettle(win: BrowserWindow, url: string, settleMs: number): Promise<void> {
  await win.loadURL(url, { userAgent: USER_AGENT }).catch(() => undefined);
  await delay(settleMs);
}

export async function harvestCookies(url: string, outFile: string): Promise<boolean> {
  const key = siteKey(url);
  if (!key) return false;

  const ses = session.fromPartition(PARTITION);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: PARTITION },
  });
  win.webContents.setUserAgent(USER_AGENT);

  try {
    await loadAndSettle(win, siteHome(key), 3500);
    await loadAndSettle(win, url, key === 'douyin' ? 6000 : 5000);

    const cookies = await ses.cookies.get({});
    if (!cookies.length) return false;

    const now = Math.floor(Date.now() / 1000);
    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
      const domain = c.domain || '';
      const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : now + 31536000;
      lines.push([domain, includeSub, c.path || '/', secure, String(expiry), c.name, c.value].join('\t'));
    }
    fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
    return true;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
