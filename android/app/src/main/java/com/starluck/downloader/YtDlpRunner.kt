package com.starluck.downloader

import android.content.Context
import android.os.Environment
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.io.File

data class VideoInfo(
    val title: String, val thumbnail: String, val duration: Double,
    val uploader: String, val extractor: String
)

data class ProgressData(
    val percent: Float, val speed: String, val size: String, val eta: String,
    val status: String /* downloading / processing / done / error */,
    val file: String? = null, val error: String? = null
)

class YtDlpRunner(private val context: Context) {

    companion object {
        private const val BIN_NAME = "ytdlp_arm64"
    }

    private fun binPath(): File {
        val dir = context.getExternalFilesDir(null) ?: context.filesDir
        val f = File(dir, BIN_NAME)
        if (!f.exists()) {
            // 从 assets 复制到可执行目录
            context.assets.open(BIN_NAME).use { input ->
                f.outputStream().use { output -> input.copyTo(output) }
            }
            f.setExecutable(true)
        }
        return f
    }

    private fun ffmpegPath(): File {
        val dir = context.getExternalFilesDir(null) ?: context.filesDir
        val f = File(dir, "ffmpeg_arm64")
        if (!f.exists()) {
            context.assets.open("ffmpeg_arm64").use { input ->
                f.outputStream().use { output -> input.copyTo(output) }
            }
            f.setExecutable(true)
        }
        return f
    }

    suspend fun getVideoInfo(url: String): VideoInfo = withContext(Dispatchers.IO) {
        val bin = binPath()
        val proc = ProcessBuilder(
            bin.absolutePath, "--no-playlist", "--dump-single-json", url
        ).redirectErrorStream(true).start()

        val stdout = proc.inputStream.bufferedReader().readText()
        proc.waitFor()

        val json = Gson().fromJson(stdout, JsonObject::class.java)
        val thumb = json.get("thumbnail")?.asString ?: ""
        VideoInfo(
            title = json.get("title")?.asString ?: (json.get("id")?.asString ?: url),
            thumbnail = thumb,
            duration = json.get("duration")?.asDouble ?: 0.0,
            uploader = json.get("uploader")?.asString
                ?: (json.get("channel")?.asString ?: ""),
            extractor = json.get("extractor_key")?.asString
                ?: (json.get("extractor")?.asString ?: "")
        )
    }

    fun startDownload(
        url: String,
        quality: String,
        outputDir: String? = null
    ): Flow<ProgressData> = flow {
        val bin = binPath()
        val ffmpeg = ffmpegPath()
        val dir = outputDir
            ?: Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath

        val args = mutableListOf(
            bin.absolutePath, url, "--no-playlist", "--newline",
            "-o", "$dir/%(title)s.%(ext)s"
        )

        // 画质选择
        when (quality) {
            "audio" -> args.addAll(listOf("-x", "--audio-format", "mp3", "--audio-quality", "0"))
            "1080" -> args.addAll(listOf("-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"))
            "720" -> args.addAll(listOf("-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"))
            "480" -> args.addAll(listOf("-f", "bv*[height<=480]+ba/b[height<=480]", "--merge-output-format", "mp4"))
            else -> args.addAll(listOf("-f", "bv*+ba/b", "--merge-output-format", "mp4"))
        }

        // ffmpeg 路径
        if (ffmpeg.exists()) {
            args.addAll(listOf("--ffmpeg-location", ffmpeg.absolutePath))
        }

        val proc = ProcessBuilder(args)
            .redirectErrorStream(true)
            .start()

        val reader = proc.inputStream.bufferedReader()
        var lastPercent = 0f
        var finalFile: String? = null

        try {
            reader.forEachLine { line ->
                // 进度解析： [download] 45.2% of 10.5MiB at 2.3MiB/s ETA 00:12
                val pctMatch = Regex("""\[download\]\s+([\d.]+)%""").find(line)
                if (pctMatch != null) {
                    lastPercent = pctMatch.groupValues[1].toFloatOrNull() ?: lastPercent
                    val speed = Regex("""at\s+([\d.]+\w+/s)""").find(line)?.groupValues?.get(1) ?: ""
                    val size = Regex("""of\s+~?([\d.]+\w+)""").find(line)?.groupValues?.get(1) ?: ""
                    val eta = Regex("""ETA\s+(\S+)""").find(line)?.groupValues?.get(1) ?: ""
                    emit(ProgressData(lastPercent, speed, size, eta, "downloading"))
                }

                // 文件路径捕获
                val dest = Regex("""Destination:\s*(.+)""").find(line)
                val merge = Regex("""Merging formats into "(.+)"""".find(line))
                if (dest != null) finalFile = dest.groupValues[1].trim()
                if (merge != null) finalFile = merge.groupValues[1].trim()

                if (Regex("""Merging|ExtractAudio|Post-process""").containsMatchIn(line)) {
                    emit(ProgressData(100f, "", "", "", "processing"))
                }
            }

            val exitCode = proc.waitFor()
            if (exitCode == 0) {
                emit(ProgressData(100f, "", "", "", "done", file = finalFile))
            } else {
                emit(ProgressData(lastPercent, "", "", "", "error", error = "yt-dlp exit code $exitCode"))
            }
        } catch (e: Exception) {
            emit(ProgressData(lastPercent, "", "", "", "error", error = e.message ?: "unknown"))
        } finally {
            proc.destroy()
        }
    }
}
