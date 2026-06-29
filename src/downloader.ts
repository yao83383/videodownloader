import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import YTDlpWrap from 'yt-dlp-wrap';
import ffmpegStatic from 'ffmpeg-static';
import { USER_AGENT, DOUYIN_ENABLED } from './constants';

export type Quality = 'best' | '1080' | '720' | '480' | 'audio' | 'music_mp3' | 'music_flac';

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  extractor: string;
}

export interface CookieOpts {
  cookiesFromBrowser?: string;
  cookiesFile?: string;
}

export interface DownloadRequest extends CookieOpts {
  url: string;
  quality: Quality;
  outputDir: string;
}

export interface ProgressData {
  id: string;
  status: 'downloading' | 'processing' | 'done' | 'error';
  percent: number;
  speed: string;
  eta: string;
  size?: string;
  title?: string;
  file?: string;
  dir?: string;
  error?: string;
}

const ytDlpBinaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

export class Downloader {
  private ytDlp!: YTDlpWrap;
  private ffmpegDir: string | null = null;
  private hasAria2c = false;
  private counter = 0;

  constructor(private binDir: string) {}

  get aria2cAvailable(): boolean {
    return this.hasAria2c;
  }

  private normalizeUrl(url: string): string {
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    // 去掉 # 后面的部分（HTTP 不传哈希，yt-dlp 拿不到真实 ID）
    const hashIdx = u.indexOf('#');
    if (hashIdx > -1) u = u.slice(0, hashIdx);
    // 网易云 SPA 路由：#/song?id=xxx → /song?id=xxx
    if (/music\.163\.com/i.test(u)) {
      const hm = /[?&]id=(\d+)/.exec(url.slice(url.indexOf('#') + 1));
      if (hm && !/[?&]id=/.test(u)) {
        u = u.replace(/\/*$/, '/song?id=' + hm[1]);
      }
    }
    if (/douyin\.com/i.test(u)) {
      const m = /[?&]modal_id=(\d+)/.exec(u);
      if (m) return `https://www.douyin.com/video/${m[1]}`;
    }
    return u;
  }

  private validateUrl(url: string): void {
    if (/douyin\.com|iesdouyin\.com/i.test(url)) {
      if (!DOUYIN_ENABLED) {
        throw new Error('抖音下载暂不可用，敬请期待。');
      }
      const isVideo =
        /douyin\.com\/video\/\d+/i.test(url) ||
        /v\.douyin\.com\//i.test(url) ||
        /iesdouyin\.com/i.test(url);
      if (!isVideo) {
        throw new Error(
          '这是抖音首页/推荐流链接,不是具体视频。请在视频上点“分享→复制链接”得到 v.douyin.com 短链,或使用带 modal_id / video 视频号的链接。'
        );
      }
    }
  }

  private siteArgs(url: string, opts?: CookieOpts): string[] {
    const isMusic = /music\.163\.com|kugou\.com|y\.qq\.com/i.test(url);
    const args: string[] = [];
    // 音乐站不强制覆盖 UA，交给 yt-dlp 自带提取器处理（避免海外误判）
    if (!isMusic) {
      args.push('--user-agent', USER_AGENT);
    }
    if (/bilibili\.com|b23\.tv/i.test(url)) {
      args.push('--referer', 'https://www.bilibili.com/');
    }
    if (opts?.cookiesFile) {
      args.push('--cookies', opts.cookiesFile);
    } else if (opts?.cookiesFromBrowser) {
      args.push('--cookies-from-browser', opts.cookiesFromBrowser);
    }
    return args;
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.binDir, { recursive: true });
    const binPath = path.join(this.binDir, ytDlpBinaryName);

    if (!fs.existsSync(binPath)) {
      await YTDlpWrap.downloadFromGithub(binPath);
    }

    this.ytDlp = new YTDlpWrap(binPath);

    if (ffmpegStatic) {
      const ffmpegPath = ffmpegStatic.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      this.ffmpegDir = path.dirname(ffmpegPath);
    }

    this.hasAria2c = await this.detectAria2c();
  }

  async updateBinary(): Promise<string> {
    const out = await this.ytDlp.execPromise(['--update-to', 'nightly']);
    return out.trim() || '已是最新版本。';
  }

  private detectAria2c(): Promise<boolean> {
    return new Promise((resolve) => {
      const finder = process.platform === 'win32' ? 'where' : 'which';
      const p = spawn(finder, ['aria2c']);
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
  }

  private speedArgs(): string[] {
    const args = ['--concurrent-fragments', '16'];
    if (this.hasAria2c) {
      args.push('--downloader', 'aria2c', '--downloader-args', 'aria2c:-x16 -s16 -k1M');
    }
    return args;
  }

  async getVideoInfo(rawUrl: string, opts?: CookieOpts): Promise<VideoInfo> {
    const url = this.normalizeUrl(rawUrl);
    this.validateUrl(url);
    const stdout = await this.ytDlp.execPromise([
      '--no-playlist',
      '--dump-single-json',
      ...this.siteArgs(url, opts),
      url,
    ]);
    const meta: any = JSON.parse(stdout);
    const thumb =
      meta.thumbnail ||
      (Array.isArray(meta.thumbnails) && meta.thumbnails.length
        ? meta.thumbnails[meta.thumbnails.length - 1].url
        : '');

    return {
      title: meta.title || meta.id || url,
      thumbnail: thumb || '',
      duration: typeof meta.duration === 'number' ? meta.duration : 0,
      uploader: meta.uploader || meta.channel || meta.extractor_key || '',
      extractor: meta.extractor_key || meta.extractor || '',
    };
  }

  private buildFormatArgs(quality: Quality): string[] {
    const sort = ['-S', 'vcodec:h264,res,acodec:aac'];
    switch (quality) {
      case 'audio':
        return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
      case 'music_mp3':
        return ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata', '--embed-thumbnail', '--geo-bypass', '--geo-bypass-country', 'CN'];
      case 'music_flac':
        return ['-x', '--audio-format', 'flac', '--embed-metadata', '--embed-thumbnail', '--geo-bypass', '--geo-bypass-country', 'CN'];
      case '1080':
        return ['-f', 'bv*[height<=1080]+ba/b[height<=1080]', ...sort, '--merge-output-format', 'mp4'];
      case '720':
        return ['-f', 'bv*[height<=720]+ba/b[height<=720]', ...sort, '--merge-output-format', 'mp4'];
      case '480':
        return ['-f', 'bv*[height<=480]+ba/b[height<=480]', ...sort, '--merge-output-format', 'mp4'];
      case 'best':
      default:
        return ['-f', 'bv*+ba/b', ...sort, '--merge-output-format', 'mp4'];
    }
  }

  startDownload(req: DownloadRequest, onProgress: (p: ProgressData) => void): string {
    const id = `${Date.now()}-${++this.counter}`;
    const url = this.normalizeUrl(req.url);
    this.validateUrl(url);
    const outputTemplate = path.join(req.outputDir, '%(title)s.%(ext)s');

    const args: string[] = [
      url,
      '--no-playlist',
      '--newline',
      '-o',
      outputTemplate,
      ...this.siteArgs(url, req),
      ...this.speedArgs(),
      ...this.buildFormatArgs(req.quality),
    ];

    if (this.ffmpegDir) {
      args.push('--ffmpeg-location', this.ffmpegDir);
    }

    let lastPercent = 0;
    let finalFile: string | undefined;

    const emitter = this.ytDlp.exec(args);

    emitter.on('progress', (progress: any) => {
      lastPercent = typeof progress.percent === 'number' ? progress.percent : lastPercent;
      onProgress({
        id,
        status: 'downloading',
        percent: lastPercent,
        speed: progress.currentSpeed || '',
        eta: progress.eta || '',
        size: progress.totalSize || '',
      });
    });

    emitter.on('ytDlpEvent', (_type: string, data: string) => {
      const dest = /Destination:\s*(.+)\s*$/.exec(data) || /Merging formats into "(.+)"/.exec(data);
      if (dest) finalFile = dest[1].trim();
      if (/Merging formats|ExtractAudio|Post-process/i.test(data)) {
        onProgress({ id, status: 'processing', percent: 100, speed: '', eta: '' });
      }
    });

    emitter.on('error', (err: Error) => {
      onProgress({ id, status: 'error', percent: lastPercent, speed: '', eta: '', error: err.message });
    });

    emitter.on('close', (code: number | null) => {
      if (code === 0) {
        onProgress({ id, status: 'done', percent: 100, speed: '', eta: '', file: finalFile, dir: req.outputDir });
      } else {
        onProgress({
          id,
          status: 'error',
          percent: lastPercent,
          speed: '',
          eta: '',
          error: `yt-dlp exited with code ${code}`,
        });
      }
    });

    return id;
  }
}
