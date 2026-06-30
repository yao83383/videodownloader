package com.starluck.downloader

import android.annotation.SuppressLint
import android.app.Activity
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.view.ViewGroup
import android.widget.Toast
import java.io.File

class YouTubeLoginActivity : Activity() {

    companion object {
        const val COOKIES_FILE = "cookies_youtube.txt"
        private const val LOGIN_URL =
            "https://accounts.google.com/signin/v2/identifier?service=youtube"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        val doneBtn = Button(this).apply {
            text = "已完成登录，点此返回"
            visibility = android.view.View.GONE  // 登录完成前隐藏
            setBackgroundColor(0xFF3F8CFF.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setOnClickListener { saveCookiesAndFinish() }
        }
        root.addView(doneBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString =
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 到达 YouTube 时显示完成按钮（非登录页）
                    if (url != null && url.contains("youtube.com") && !url.contains("signin") && !url.contains("accounts.google")) {
                        doneBtn.visibility = android.view.View.VISIBLE
                    }
                }
            }
        }

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(webView, true)

        webView.loadUrl(LOGIN_URL)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun saveCookiesAndFinish() {
        val cm = CookieManager.getInstance()
        cm.flush()
        // flush 是异步的——等 500ms 确保写到磁盘
        Thread.sleep(500)

        val lines = mutableListOf("# Netscape HTTP Cookie File")
        val expire = (System.currentTimeMillis() / 1000) + 365 * 86400
        var ok = false

        // 尝试读取 WebView cookie SQLite 数据库（含 HttpOnly cookie）
        val dbPaths = listOf(
            "$dataDir/../app_webview/Cookies",
            "$dataDir/app_webview/Cookies",
            "$dataDir/../app_webview/Default/Cookies"
        )
        var dbRead = false
        for (dp in dbPaths) {
            try {
                val dbFile = File(dp)
                if (!dbFile.exists()) continue
                val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
                val cursor = db.rawQuery("SELECT host_key, name, value, path, is_secure, expires_utc FROM cookies", null)
                while (cursor.moveToNext()) {
                    val host = cursor.getString(0)
                    val name = cursor.getString(1)
                    val value = cursor.getString(2)
                    val path = cursor.getString(3)
                    val secure = cursor.getInt(4) == 1
                    val rawExp = cursor.getLong(5)
                    // expires_utc 可能是微秒（WebKit 格式）或秒
                    val cookieExp = if (rawExp > 1e12) rawExp / 1_000_000 else rawExp
                    val domain = host.let { h -> if (!h.isNullOrBlank()) h else ".youtube.com" }
                    val includeSub = if (domain.startsWith(".")) "TRUE" else "FALSE"
                    val sec = if (secure) "TRUE" else "FALSE"
                    lines.add("$domain\t$includeSub\t${path ?: "/"}\t$sec\t$cookieExp\t${name}\t${value}")
                    ok = true
                }
                cursor.close()
                db.close()
                dbRead = true
                break
            } catch (_: Exception) { }
        }

        // 退路：CookieManager API 兜底（拿不到 HttpOnly，但至少有点东西）
        if (!dbRead) {
            val domains = listOf("https://youtube.com", "https://accounts.google.com", "https://google.com", "https://www.youtube.com")
            val seen = mutableSetOf<String>()
            for (url in domains) {
                for (part in (cm.getCookie(url) ?: "").split("; ")) {
                    val kv = part.split("=", limit = 2)
                    if (kv.size == 2 && kv[0].isNotBlank() && seen.add(kv[0])) {
                        lines.add(".youtube.com\tTRUE\t/\tTRUE\t$expire\t${kv[0]}\t${kv[1]}")
                        ok = true
                    }
                }
            }
        }

        if (ok && lines.size > 1) {
            File(filesDir, COOKIES_FILE).writeText(lines.joinToString("\n") + "\n")
            Toast.makeText(this, "Cookie 已保存 (${lines.size - 1} 条)", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "未获取到 Cookie (DB=$dbRead)", Toast.LENGTH_LONG).show()
        }
        finish()
    }
}
