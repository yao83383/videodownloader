(() => {
  const api = (window as any).api;

  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  const statusEl = $('status');
  const urlEl = $<HTMLInputElement>('url');
  const parseBtn = $<HTMLButtonElement>('parse');
  const cardEl = $('card');
  const thumbEl = $<HTMLImageElement>('thumb');
  const titleEl = $('title');
  const metaEl = $('meta');
  const qualityEl = $<HTMLSelectElement>('quality');
  const cookiesEl = $<HTMLSelectElement>('cookies');
  const cookiesFileEl = $<HTMLInputElement>('cookiesFile');
  const chooseCookiesBtn = $<HTMLButtonElement>('chooseCookies');
  const clearCookiesBtn = $<HTMLButtonElement>('clearCookies');
  const loginBiliBtn = $<HTMLButtonElement>('loginBili');
  const loginDouyinBtn = $<HTMLButtonElement>('loginDouyin');
  const loginYoutubeBtn = $<HTMLButtonElement>('loginYoutube');

  const cookieOpts = () => ({
    cookiesFromBrowser: cookiesEl.value || undefined,
    cookiesFile: cookiesFileEl.value || undefined,
  });
  const dirEl = $<HTMLInputElement>('dir');
  const chooseBtn = $<HTMLButtonElement>('choose');
  const downloadBtn = $<HTMLButtonElement>('download');
  const updateBtn = $<HTMLButtonElement>('update');
  const listEl = $('list');
  const licenseOverlay = $('license');
  const licenseMsgEl = $('licenseMsg');
  const licenseKeyEl = $<HTMLInputElement>('licenseKey');
  const licenseActivateBtn = $<HTMLButtonElement>('licenseActivate');
  const deviceIdEl = $('deviceId');
  const licenseExpiryEl = $('licenseExpiry');
  const licenseBadgeEl = $('licenseBadge');
  const deviceCodeEl = $('deviceCode');
  const copyDeviceBtn = $<HTMLButtonElement>('copyDevice');
  const previewBtn = $<HTMLButtonElement>('preview');
  const licenseCloseBtn = $<HTMLButtonElement>('licenseClose');
  // 音乐标签
  const urlMusEl = $<HTMLInputElement>('url-music');
  const parseMusBtn = $<HTMLButtonElement>('parse-music');
  const cardMusEl = $('card-music');
  const thumbMusEl = $<HTMLImageElement>('thumb-music');
  const titleMusEl = $('title-music');
  const metaMusEl = $('meta-music');
  const qualityMusEl = $<HTMLSelectElement>('quality-music');
  const previewMusBtn = $<HTMLButtonElement>('preview-music');
  const loginNeteaseBtn = $<HTMLButtonElement>('loginNetease');
  const loginKugouBtn = $<HTMLButtonElement>('loginKugou');
  const loginQQMusicBtn = $<HTMLButtonElement>('loginQQMusic');
  const tabVidBtn = document.querySelector('.tab[data-tab="video"]') as HTMLButtonElement;
  const tabMusBtn = document.querySelector('.tab[data-tab="music"]') as HTMLButtonElement;
  const videoPanel = $('tab-video');
  const musicPanel = $('tab-music');

  let activeTab: 'video' | 'music' = 'video';
  qualityEl.innerHTML = `<option value="best">最佳质量</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="audio">仅音频 (MP3)</option>`;

  function switchTab(tab: 'video' | 'music'): void {
    activeTab = tab;
    tabVidBtn.classList.toggle('active', tab === 'video');
    tabMusBtn.classList.toggle('active', tab === 'music');
    videoPanel.classList.toggle('hidden', tab !== 'video');
    musicPanel.classList.toggle('hidden', tab !== 'music');
    refreshDownloadButton();
  }

  tabVidBtn.addEventListener('click', () => switchTab('video'));
  tabMusBtn.addEventListener('click', () => switchTab('music'));

  let engineReady = false;
  let currentTitle = '';

  function activeUrlInput(): HTMLInputElement {
    return activeTab === 'video' ? urlEl : urlMusEl;
  }
  function activeCardEl(): HTMLElement { return activeTab === 'video' ? cardEl : cardMusEl; }
  function activeThumbEl(): HTMLImageElement { return activeTab === 'video' ? thumbEl : thumbMusEl; }
  function activeTitleEl(): HTMLElement { return activeTab === 'video' ? titleEl : titleMusEl; }
  function activeMetaEl(): HTMLElement { return activeTab === 'video' ? metaEl : metaMusEl; }
  function activePreviewBtn(): HTMLButtonElement { return activeTab === 'video' ? previewBtn : previewMusBtn; }
  function activeQuality(): string {
    return activeTab === 'video' ? qualityEl.value : qualityMusEl.value;
  }
  let licenseEnabled = false;
  let licensed = true;
  let pendingDownload: { url: string; dir: string; quality: string; cookies: any } | null = null;
  const names = new Map<string, string>();
  const rows = new Map<string, HTMLElement>();
  const idUrl = new Map<string, string>();
  const activeUrls = new Set<string>();

  function setStatus(text: string, kind: 'pending' | 'ok' | 'err'): void {
    statusEl.textContent = text;
    statusEl.className = `status status--${kind}`;
  }

  function refreshDownloadButton(): void {
    downloadBtn.disabled = !(engineReady && activeUrlInput().value.trim().length > 0);
  }

  function formatDuration(sec: number): string {
    if (!sec || sec < 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function applyStatus(data: any): void {
    if (data && data.ready) {
      engineReady = true;
      const speedNote = data.aria2c
        ? '已启用 aria2c 多线程加速'
        : '已启用并行分片加速（安装 aria2c 可更快）';
      setStatus(`下载引擎已就绪 · ${speedNote}。`, 'ok');
    } else {
      engineReady = false;
      setStatus(`引擎初始化失败：${(data && data.error) || '未知错误'}`, 'err');
    }
    refreshDownloadButton();
  }

  function updateBadge(status: any): void {
    if (!status || status.enabled === false) {
      licenseBadgeEl.classList.add('hidden');
      return;
    }
    licenseBadgeEl.classList.remove('hidden', 'expiring');
    if (!status.licensed) {
      licenseBadgeEl.textContent = '未授权 · 点此激活';
      licenseBadgeEl.classList.add('expiring');
      return;
    }
    let text = status.expiry ? `授权至 ${new Date(status.expiry).toLocaleDateString()}` : '永久授权';
    if (typeof status.remaining === 'number') text += ` · 剩 ${status.remaining} 次`;
    licenseBadgeEl.textContent = text;
    if (status.expiry && new Date(status.expiry).getTime() - Date.now() <= 7 * 86400000) {
      licenseBadgeEl.classList.add('expiring');
    }
  }

  function applyLicense(status: any): void {
    if (status && status.deviceId) {
      deviceIdEl.textContent = status.deviceId;
      deviceCodeEl.textContent = status.deviceId;
    }
    licenseEnabled = !!status && status.enabled !== false;
    licensed = !status || status.enabled === false || !!status.licensed;
    if (status && status.expiry) {
      licenseExpiryEl.textContent = `到期时间：${new Date(status.expiry).toLocaleString()}`;
    }
    updateBadge(status);
    // 解析/预览免费：不再自动弹蒙层，仅在“点下载且未授权”或“点徽章”时按需弹出
  }

  function showLicenseOverlay(msg?: string): void {
    if (msg) licenseMsgEl.textContent = msg;
    licenseOverlay.classList.remove('hidden');
  }
  function hideLicenseOverlay(): void {
    licenseOverlay.classList.add('hidden');
  }

  licenseBadgeEl.addEventListener('click', () => {
    if (licenseEnabled && !licensed) showLicenseOverlay('输入授权码即可下载（解析和预览免费）');
  });
  licenseCloseBtn.addEventListener('click', () => {
    pendingDownload = null;
    hideLicenseOverlay();
  });

  api.getLicense().then(applyLicense);

  licenseActivateBtn.addEventListener('click', async () => {
    const key = licenseKeyEl.value.trim();
    if (!key) {
      licenseMsgEl.textContent = '请输入授权码';
      return;
    }
    licenseActivateBtn.disabled = true;
    licenseMsgEl.textContent = '正在激活…';
    try {
      const status = await api.activateLicense(key);
      applyLicense(status);
      if (status && (status.enabled === false || status.licensed)) {
        hideLicenseOverlay();
        const pd = pendingDownload;
        pendingDownload = null;
        if (pd) startDownloadNow(pd);
      } else {
        licenseMsgEl.textContent = status.reason || '激活失败';
      }
    } catch (err: any) {
      licenseMsgEl.textContent = `激活失败：${err && err.message ? err.message : err}`;
    } finally {
      licenseActivateBtn.disabled = false;
    }
  });

  api.onStatus(applyStatus);
  api.getStatus().then(applyStatus);
  api.onStatusText((t: string) => setStatus(t, 'pending'));

  api.getDefaultDir().then((d: string) => {
    if (d) dirEl.value = d;
  });

  urlEl.addEventListener('input', refreshDownloadButton);
  urlMusEl.addEventListener('input', refreshDownloadButton);

  async function doParse(
    btn: HTMLButtonElement,
    urlInput: HTMLInputElement,
    cardDiv: HTMLElement,
    thumbImg: HTMLImageElement,
    titleDiv: HTMLElement,
    metaDiv: HTMLElement
  ): Promise<void> {
    const url = urlInput.value.trim();
    if (!url) return;
    btn.disabled = true;
    btn.textContent = '解析中…';
    try {
      const info = await api.getVideoInfo(url, cookieOpts());
      currentTitle = info.title || url;
      titleDiv.textContent = currentTitle;
      const parts = [info.uploader, info.extractor].filter(Boolean);
      if (info.duration && info.duration > 0) parts.unshift(formatDuration(info.duration));
      metaDiv.textContent = parts.join('  ·  ') || url;
      if (info.thumbnail) {
        thumbImg.src = info.thumbnail;
        thumbImg.style.display = '';
      } else {
        thumbImg.style.display = 'none';
      }
      cardDiv.classList.remove('hidden');
    } catch (err: any) {
      cardDiv.classList.add('hidden');
      const msg = (err && err.message) ? err.message : String(err || '');
      const isMusicFail = activeTab === 'music' && /list index out of range|geo restrict|No media links found/i.test(msg);
      if (isMusicFail && url) {
        api.openExternal(url); // 打开网易云原页面,让用户看到歌名
        setStatus('本歌曲飞走了，建议使用B站或YouTube搜索并下载仅MP3', 'err');
      } else {
        setStatus(`解析失败：${msg}`, 'err');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '解析';
    }
  }

  parseBtn.addEventListener('click', () => doParse(parseBtn, urlEl, cardEl, thumbEl, titleEl, metaEl));
  parseMusBtn.addEventListener('click', () => doParse(parseMusBtn, urlMusEl, cardMusEl, thumbMusEl, titleMusEl, metaMusEl));

  chooseBtn.addEventListener('click', async () => {
    const dir = await api.selectDir();
    if (dir) dirEl.value = dir;
  });

  previewBtn.addEventListener('click', () => {
    const url = urlEl.value.trim();
    if (url) api.openExternal(url);
  });
  previewMusBtn.addEventListener('click', () => {
    const url = urlMusEl.value.trim();
    if (url) api.openExternal(url);
  });

  chooseCookiesBtn.addEventListener('click', async () => {
    const f = await api.selectCookiesFile();
    if (f) cookiesFileEl.value = f;
  });

  clearCookiesBtn.addEventListener('click', () => {
    cookiesFileEl.value = '';
  });

  async function doLogin(site: string, btn: HTMLButtonElement): Promise<void> {
    const labelMap: Record<string, string> = { douyin: '抖音', youtube: 'YouTube', bilibili: 'B站', netease: '网易云音乐', kugou: '酷狗音乐', qqmusic: 'QQ 音乐' };
    const label = labelMap[site] || site;
    btn.disabled = true;
    setStatus(`已打开${label}登录窗口，登录完成后关闭该窗口即可…`, 'pending');
    try {
      await api.login(site);
      setStatus(`${label}登录信息已保存，直接粘链接解析即可（自动使用）。`, 'ok');
    } catch (err: any) {
      setStatus(`登录失败：${err && err.message ? err.message : err}`, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  loginBiliBtn.addEventListener('click', () => doLogin('bilibili', loginBiliBtn));
  loginDouyinBtn.addEventListener('click', () => doLogin('douyin', loginDouyinBtn));
  loginYoutubeBtn.addEventListener('click', () => doLogin('youtube', loginYoutubeBtn));
  loginNeteaseBtn.addEventListener('click', () => doLogin('netease', loginNeteaseBtn));
  loginKugouBtn.addEventListener('click', () => doLogin('kugou', loginKugouBtn));
  loginQQMusicBtn.addEventListener('click', () => doLogin('qqmusic', loginQQMusicBtn));

  copyDeviceBtn.addEventListener('click', async () => {
    const code = deviceCodeEl.textContent || '';
    if (!code || code === '…') return;
    try {
      await navigator.clipboard.writeText(code);
      const old = copyDeviceBtn.textContent;
      copyDeviceBtn.textContent = '已复制';
      setTimeout(() => (copyDeviceBtn.textContent = old), 1500);
    } catch {
      /* ignore */
    }
  });

  updateBtn.addEventListener('click', async () => {
    const oldText = updateBtn.textContent || '更新 yt-dlp';
    updateBtn.disabled = true;
    updateBtn.textContent = '更新中…';
    setStatus('正在更新 yt-dlp（切换到 nightly），请稍候…', 'pending');
    try {
      const res = await api.updateYtdlp();
      setStatus(
        res.ok ? `yt-dlp 更新完成：${res.message}` : `更新失败：${res.message}`,
        res.ok ? 'ok' : 'err'
      );
    } catch (err: any) {
      setStatus(`更新失败：${err && err.message ? err.message : err}`, 'err');
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = oldText;
    }
  });

  function ensureRow(id: string): HTMLElement {
    let row = rows.get(id);
    if (row) return row;

    const empty = listEl.querySelector('.empty');
    if (empty) empty.remove();

    row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="item__top">
        <span class="item__name">${names.get(id) || '下载任务'}</span>
        <span class="item__state">等待中…</span>
      </div>
      <div class="bar"><span></span></div>`;
    listEl.prepend(row);
    rows.set(id, row);
    return row;
  }

  api.onProgress((p: any) => {
    const row = ensureRow(p.id);
    const nameEl = row.querySelector('.item__name') as HTMLElement;
    const stateEl = row.querySelector('.item__state') as HTMLElement;
    const bar = row.querySelector('.bar') as HTMLElement;
    const fill = row.querySelector('.bar > span') as HTMLElement;

    if (names.get(p.id)) nameEl.textContent = names.get(p.id)!;

    const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    fill.style.width = `${pct}%`;
    stateEl.className = 'item__state';
    bar.className = 'bar';

    if (p.status === 'downloading') {
      const parts = [`${pct.toFixed(1)}%`];
      if (p.speed) parts.push(p.speed);
      if (p.size) parts.push(`共 ${p.size}`);
      if (p.eta) parts.push(`剩余 ${p.eta}`);
      stateEl.textContent = parts.join('  ·  ');
    } else if (p.status === 'processing') {
      stateEl.textContent = '合并/转码中…';
    } else if (p.status === 'done') {
      bar.classList.add('ok');
      fill.style.width = '100%';
      stateEl.classList.add('ok');
      stateEl.textContent = '完成 · 打开所在文件夹';
      const target = p.file || p.dir;
      if (target) {
        stateEl.onclick = () => api.openPath(target);
      }
    } else if (p.status === 'error') {
      bar.classList.add('err');
      stateEl.classList.add('err');
      stateEl.textContent = `失败：${p.error || '未知错误'}`;
    }

    if (p.status === 'done' || p.status === 'error') {
      const u = idUrl.get(p.id);
      if (u) {
        activeUrls.delete(u);
        idUrl.delete(p.id);
      }
      if (licenseEnabled) api.getLicense().then(applyLicense);
    }
  });

  async function startDownloadNow(params: {
    url: string;
    dir: string;
    quality: string;
    cookies: any;
  }): Promise<void> {
    const { url, dir, quality, cookies } = params;
    if (activeUrls.has(url)) {
      setStatus('该链接正在下载中，请勿重复下载。', 'err');
      return;
    }
    const name = currentTitle || url;
    activeUrls.add(url);
    downloadBtn.disabled = true;
    try {
      const id: string = await api.startDownload({ url, quality, outputDir: dir, ...cookies });
      names.set(id, name);
      idUrl.set(id, url);
      const row = ensureRow(id);
      (row.querySelector('.item__name') as HTMLElement).textContent = name;
    } catch (err: any) {
      activeUrls.delete(url);
      setStatus(`无法开始下载：${err && err.message ? err.message : err}`, 'err');
    } finally {
      refreshDownloadButton();
    }
  }

  downloadBtn.addEventListener('click', () => {
    const url = activeUrlInput().value.trim();
    const dir = dirEl.value.trim();
    if (!url || !dir) {
      setStatus('请填写链接和保存目录。', 'err');
      return;
    }
    const params = { url, dir, quality: activeQuality(), cookies: cookieOpts() };
    if (licenseEnabled && !licensed) {
      pendingDownload = params;
      showLicenseOverlay('下载需要激活授权码（解析和预览是免费的）');
      return;
    }
    startDownloadNow(params);
  });
})();
