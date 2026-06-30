package com.starluck.downloader

import android.annotation.SuppressLint
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

/**
 * 等价于 PC 端 cookies.ts 的 harvestCookies()：
 * 用 invisible WebView 访问 youtube.com 主页 + 目标视频，让 YouTube 自动 rotate 出
 * 最新的 SID/SIDTS/VISITOR_DATA，然后从 WebView 的 SQLite cookies 库重新导出 Netscape
 * 格式给 yt-dlp。否则手机端用户手动登录后导出的 cookies 文件一旦被 YouTube rotate
 * 就会失效，下载只能拿到 storyboard。
 */
object CookieRefresher {

    private const val UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    @SuppressLint("SetJavaScriptEnabled")
    suspend fun refresh(context: Context, targetUrl: String, outFile: File): Boolean {
        return try {
            withContext(Dispatchers.Main) {
                val webView = WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.userAgentString = UA
                }
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)
                cm.setAcceptThirdPartyCookies(webView, true)
                try {
                    visit(webView, "https://www.youtube.com/")
                    visit(webView, targetUrl)
                    cm.flush()
                    delay(700)
                } finally {
                    webView.stopLoading()
                    webView.destroy()
                }
            }
            withContext(Dispatchers.IO) { exportNetscape(context, outFile) }
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun visit(webView: WebView, url: String) {
        suspendCancellableCoroutine<Unit> { cont ->
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, u: String?) {
                    super.onPageFinished(view, u)
                    if (cont.isActive) cont.resume(Unit)
                }
            }
            webView.loadUrl(url)
        }
        delay(2500)
    }

    private fun exportNetscape(context: Context, outFile: File): Boolean {
        val lines = mutableListOf("# Netscape HTTP Cookie File")
        val dataDir = context.dataDir.absolutePath
        val dbPaths = listOf(
            "$dataDir/app_webview/Cookies",
            "$dataDir/app_webview/Default/Cookies",
            "$dataDir/../app_webview/Cookies",
            "$dataDir/../app_webview/Default/Cookies"
        )
        var ok = false
        for (dp in dbPaths) {
            try {
                val dbFile = File(dp)
                if (!dbFile.exists()) continue
                val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
                val cursor = db.rawQuery(
                    "SELECT host_key,name,value,path,is_secure,expires_utc FROM cookies", null
                )
                while (cursor.moveToNext()) {
                    val host = (cursor.getString(0) ?: ".youtube.com")
                    val name = cursor.getString(1) ?: continue
                    val value = cursor.getString(2) ?: ""
                    val path = cursor.getString(3) ?: "/"
                    val secure = cursor.getInt(4) == 1
                    val rawExp = cursor.getLong(5)
                    val cookieExp = if (rawExp > 1e12) rawExp / 1_000_000 else rawExp
                    val includeSub = if (host.startsWith(".")) "TRUE" else "FALSE"
                    val sec = if (secure) "TRUE" else "FALSE"
                    lines.add("$host\t$includeSub\t$path\t$sec\t$cookieExp\t$name\t$value")
                    ok = true
                }
                cursor.close()
                db.close()
                break
            } catch (_: Exception) { }
        }
        if (ok) outFile.writeText(lines.joinToString("\n") + "\n")
        return ok
    }
}
