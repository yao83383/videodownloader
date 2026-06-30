package com.starluck.downloader

import android.app.Application
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(this))
        }
        // QuickJS 路径由 downloader.py 的 _auto_detect_qjs() 在 import 时自己探测，
        // 这里不需要再注入；先让 Python 模块被加载一次，触发 auto-detect。
        try {
            Python.getInstance().getModule("downloader")
        } catch (_: Exception) {}
    }
}
