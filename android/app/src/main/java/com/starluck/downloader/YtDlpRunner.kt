package com.starluck.downloader

import android.content.Context
import android.os.Environment
import com.chaquo.python.Python
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

data class VideoInfo(
    val title: String, val thumbnail: String, val duration: Double,
    val uploader: String, val extractor: String
)

data class ProgressData(
    val percent: Float, val speed: String, val size: String, val eta: String,
    val status: String,
    val file: String? = null, val error: String? = null
)

class YtDlpRunner(private val context: Context, private val cookiesFile: File? = null) {

    private fun py() = Python.getInstance()
    private fun module() = py().getModule("downloader")
    private fun cookiesPath(): String = cookiesFile?.absolutePath ?: ""

    private fun ffmpegPath(): String {
        // 走 nativeLibraryDir 避免 Android 10+ filesDir 的 W^X 限制
        val f = File(context.applicationInfo.nativeLibraryDir, "libffmpeg.so")
        return if (f.exists() && f.canExecute()) f.absolutePath else ""
    }

    private val ffmpeg by lazy { ffmpegPath() }

    private suspend fun refreshCookiesIfNeeded(url: String) {
        val f = cookiesFile ?: return
        if (!url.contains("youtube", true) && !url.contains("youtu.be", true)) return
        // 等价于 PC 端 harvestCookies：让 WebView 后台访问目标视频，让 YouTube
        // rotate cookies，再重新导出到文件，避免 SID 失效导致 storyboard-only。
        CookieRefresher.refresh(context, url, f)
    }

    suspend fun getVideoInfo(url: String): VideoInfo = withContext(Dispatchers.IO) {
        refreshCookiesIfNeeded(url)
        val raw = module().callAttr("get_info", url, cookiesPath()).toString()
        val json = Gson().fromJson(raw, JsonObject::class.java)
        VideoInfo(
            title = json.get("title")?.asString ?: url,
            thumbnail = json.get("thumbnail")?.asString ?: "",
            duration = json.get("duration")?.asDouble ?: 0.0,
            uploader = json.get("uploader")?.asString ?: "",
            extractor = json.get("extractor")?.asString ?: ""
        )
    }

    /** Python 端通过 Chaquopy 调这个对象的 update 方法实时上报下载进度。 */
    class ProgressBridge(private val onUpdate: (Float, String, String, String) -> Unit) {
        @Suppress("unused")  // Python 通过反射调用
        fun update(percent: Double, speed: String, eta: String, status: String) {
            onUpdate(percent.toFloat(), speed, eta, status)
        }
    }

    suspend fun startDownload(
        url: String,
        quality: String,
        outputDir: String? = null,
        onProgress: (percent: Float, speed: String, eta: String, status: String) -> Unit = { _, _, _, _ -> }
    ): ProgressData = withContext(Dispatchers.IO) {
        val out = outputDir
            ?: Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
        refreshCookiesIfNeeded(url)
        val bridge = ProgressBridge(onProgress)
        val raw = module().callAttr("download", url, quality, out, cookiesPath(), ffmpeg, bridge).toString()
        val json = Gson().fromJson(raw, JsonObject::class.java)
        val status = json.get("status")?.asString ?: "error"
        ProgressData(
            percent = if (status == "done") 100f else 0f,
            speed = "", size = "", eta = "",
            status = status,
            file = json.get("file")?.asString,
            error = json.get("error")?.asString
        )
    }
}
