import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getDefaultDir: (): Promise<string> => ipcRenderer.invoke('app:get-default-dir'),
  selectDir: (): Promise<string | null> => ipcRenderer.invoke('app:select-dir'),
  getVideoInfo: (url: string, opts?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('app:get-video-info', url, opts),
  startDownload: (req: unknown): Promise<string> => ipcRenderer.invoke('app:start-download', req),
  selectCookiesFile: (): Promise<string | null> => ipcRenderer.invoke('app:select-cookies-file'),
  getStatus: (): Promise<{ ready: boolean; error?: string }> => ipcRenderer.invoke('app:get-status'),
  updateYtdlp: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('app:update-ytdlp'),
  login: (site: string): Promise<boolean> => ipcRenderer.invoke('app:login', site),
  getLicense: (): Promise<any> => ipcRenderer.invoke('app:get-license'),
  activateLicense: (key: string): Promise<any> => ipcRenderer.invoke('app:activate-license', key),
  openPath: (target: string): Promise<void> => ipcRenderer.invoke('app:open-path', target),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
  onProgress: (cb: (data: unknown) => void): void => {
    ipcRenderer.on('download:progress', (_e, data) => cb(data));
  },
  onStatus: (cb: (data: unknown) => void): void => {
    ipcRenderer.on('app:status', (_e, data) => cb(data));
  },
  onStatusText: (cb: (text: string) => void): void => {
    ipcRenderer.on('app:status-text', (_e, text) => cb(text));
  },
});
