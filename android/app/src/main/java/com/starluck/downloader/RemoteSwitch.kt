package com.starluck.downloader

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

/** 遥控关闭检测：与桌面版共用同一个 status.json */
object RemoteSwitch {

    private const val STATUS_URL =
        "https://license-videodownload.justsaysayforfun.com/status.json"
    private const val CACHE_FILE = "switch-cache.json"

    data class Status(val ok: Boolean, val msg: String)

    private val client = OkHttpClient()

    suspend fun check(context: Context): Status = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(STATUS_URL).get().build()
            val body = client.newCall(req).execute().use { it.body?.string() ?: "{}" }
            val json = com.google.gson.JsonParser.parseString(body).asJsonObject
            val ok = json.get("ok")?.asBoolean ?: true
            val msg = json.get("msg")?.asString ?: ""
            // cache to file
            context.getFileStreamPath(CACHE_FILE).writeText("""{"ok":$ok,"msg":"$msg"}""")
            return@withContext Status(ok, msg)
        } catch (e: Exception) {
            // offline → read cache → allow if no cache
            val cacheFile = context.getFileStreamPath(CACHE_FILE)
            if (cacheFile.exists()) {
                try {
                    val c = com.google.gson.JsonParser.parseString(cacheFile.readText()).asJsonObject
                    return@withContext Status(c.get("ok")?.asBoolean ?: true, c.get("msg")?.asString ?: "")
                } catch (_: Exception) { }
            }
            return@withContext Status(true, "") // offline tolerance
        }
    }
}
