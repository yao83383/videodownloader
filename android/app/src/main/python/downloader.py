""" yt-dlp wrapper for Android (Chaquopy). """

import json
import os
import shutil


# ---- QuickJS 配置必须在 import yt_dlp 之前，否则模块级 jsc 检测会缓存 unavailable ----
_QJS_PATH = ""


def configure_qjs(qjs_path: str) -> str:
    """让 yt-dlp 找到打包在 jniLibs 里的 QuickJS 二进制。
    yt-dlp 默认按文件名 'qjs' 查找；Android 上文件叫 libqjs.so，所以 monkey-patch
    shutil.which 让 'qjs' 解析到我们的绝对路径，并把目录加进 PATH 做双保险。
    """
    if not qjs_path or not os.path.exists(qjs_path):
        return "qjs not found"
    _orig_which = shutil.which

    def patched_which(cmd, *args, **kwargs):
        if cmd in ("qjs", "qjs.exe"):
            return qjs_path
        return _orig_which(cmd, *args, **kwargs)

    shutil.which = patched_which
    os.environ["PATH"] = os.path.dirname(qjs_path) + os.pathsep + os.environ.get("PATH", "")
    global _QJS_PATH
    _QJS_PATH = qjs_path
    return f"qjs configured: {qjs_path}"


def _auto_detect_qjs() -> str:
    """模块加载时自动探测 libqjs.so（在 import yt_dlp 之前）。"""
    import glob
    candidates: list = []
    try:
        from java import jclass  # type: ignore
        app = jclass("android.app.ActivityThread").currentApplication()
        if app is not None:
            d = app.getApplicationInfo().nativeLibraryDir
            if d:
                candidates.append(f"{d}/libqjs.so")
    except Exception:
        pass
    for pat in ("/data/app/*com.starluck.downloader*/lib/*/libqjs.so",
                "/data/app/*/com.starluck.downloader*/lib/*/libqjs.so"):
        try:
            candidates += glob.glob(pat)
        except Exception:
            pass
    for c in candidates:
        if c and os.path.exists(c):
            return configure_qjs(c)
    return "qjs not found"


_auto_detect_qjs()

# ---- 现在才 import yt_dlp，确保 shutil.which patch 已生效 ----
from yt_dlp import YoutubeDL  # noqa: E402


_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def _add_cookies(opts: dict, cookies_file: str) -> None:
    if cookies_file and os.path.exists(cookies_file):
        opts["cookiefile"] = cookies_file


def _add_ffmpeg(opts: dict, ffmpeg_path: str) -> None:
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        opts["ffmpeg_location"] = ffmpeg_path


def _pick_thumb(info: dict) -> str:
    t = info.get("thumbnail") or ""
    if t:
        return t
    thumbs = info.get("thumbnails") or []
    if thumbs and isinstance(thumbs[-1], dict):
        return thumbs[-1].get("url", "") or ""
    return ""


def _js_runtimes_opt() -> dict:
    rt: dict = {"deno": {}}  # deno 在 Android 上自动 skip
    if _QJS_PATH and os.path.exists(_QJS_PATH):
        rt["quickjs"] = {"path": _QJS_PATH}
    return rt




def get_info(url: str, cookies_file: str = "") -> str:
    opts = {
        "quiet": True, "no_warnings": True, "no_color": True, "noplaylist": True,
        "http_headers": {"User-Agent": _USER_AGENT},
        "js_runtimes": _js_runtimes_opt(),
    }
    _add_cookies(opts, cookies_file)
    with YoutubeDL(opts) as ydl:
        # process=False 跳过 format 选择，避免解析阶段触发 "Requested format is not available"
        info = ydl.extract_info(url, download=False, process=False)
        return json.dumps({
            "title": info.get("title", "") or info.get("id", url),
            "thumbnail": _pick_thumb(info),
            "duration": info.get("duration") or 0,
            "uploader": info.get("uploader", "") or info.get("channel", ""),
            "extractor": info.get("extractor_key", "") or info.get("extractor", ""),
        })


def _parse_pct(s: str) -> float:
    try:
        return float(s.strip().rstrip("%"))
    except Exception:
        return 0.0


def download(url: str, quality: str, out_dir: str,
             cookies_file: str = "", ffmpeg_path: str = "",
             progress_cb=None) -> str:
    """progress_cb 是 Kotlin 传过来的对象，有 update(percent, speed, eta, status)。
    Chaquopy 自动桥接 Python→Java 调用。"""
    base = {
        "quiet": True, "no_warnings": True, "no_color": True, "noplaylist": True,
        "outtmpl": os.path.join(out_dir, "%(title)s.%(ext)s"),
        "http_headers": {"User-Agent": _USER_AGENT},
        "js_runtimes": _js_runtimes_opt(),
        "merge_output_format": "mp4",
        "concurrent_fragment_downloads": 4,
    }
    _add_cookies(base, cookies_file)
    _add_ffmpeg(base, ffmpeg_path)

    if quality == "audio":
        base["format"] = "bestaudio/best"
        base["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"}]
    elif quality == "1080":
        base["format"] = "bv*[height<=1080]+ba/b[height<=1080]/best/worst"
    elif quality == "720":
        base["format"] = "bv*[height<=720]+ba/b[height<=720]/best/worst"
    elif quality == "480":
        base["format"] = "bv*[height<=480]+ba/b[height<=480]/best/worst"
    else:
        base["format"] = "bv*+ba/best/worst"

    if progress_cb is not None:
        def hook(d):
            try:
                st = d.get("status", "")
                if st == "downloading":
                    pct = _parse_pct(d.get("_percent_str", "0%"))
                    speed = (d.get("_speed_str") or "").strip()
                    eta = (d.get("_eta_str") or "").strip()
                    progress_cb.update(float(pct), speed, eta, "downloading")
                elif st == "finished":
                    progress_cb.update(100.0, "", "", "processing")
            except Exception:
                pass
        base["progress_hooks"] = [hook]

    try:
        with YoutubeDL(base) as ydl:
            info = ydl.extract_info(url, download=True)
            fp = ydl.prepare_filename(info)
            if quality == "audio":
                fp = fp.rsplit(".", 1)[0] + ".mp3"
        return json.dumps({"status": "done", "file": fp})
    except Exception as e:
        return json.dumps({"status": "error", "error": str(e)})
