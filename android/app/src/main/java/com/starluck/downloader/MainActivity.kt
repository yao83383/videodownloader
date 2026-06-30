package com.starluck.downloader

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Environment
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.text.selection.SelectionContainer
import java.io.File

class MainActivity : ComponentActivity() {

    private lateinit var ytDlp: YtDlpRunner
    private lateinit var license: LicenseManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cookies = File(filesDir, "cookies_youtube.txt")
        ytDlp = YtDlpRunner(this, cookies)
        license = LicenseManager(this)
        var hasCookies = cookies.exists()

        val loginLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            // 登录返回后刷新 cookie 状态
            val c = File(filesDir, "cookies_youtube.txt")
            if (c.exists()) {
                Toast.makeText(this, "YouTube 已登录 (${c.length()} B)", Toast.LENGTH_SHORT).show()
            }
            recreate()
        }

        val importLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                try {
                    contentResolver.openInputStream(uri)?.use { input ->
                        cookies.outputStream().use { output -> input.copyTo(output) }
                    }
                    hasCookies = true
                    recreate() // 刷新界面
                } catch (e: Exception) {
                    Toast.makeText(this, "导入失败: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme()
            ) {
                MainScreen(ytDlp, license, hasCookies,
                    onLogin = { loginLauncher.launch(Intent(this, YouTubeLoginActivity::class.java)) })
            }
        }
    }
}

@Composable
fun MainScreen(ytDlp: YtDlpRunner, license: LicenseManager, hasCookies: Boolean, onLogin: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    var url by remember { mutableStateOf("") }
    var blocked by remember { mutableStateOf(false) }
    var blockMsg by remember { mutableStateOf("") }
    var statusMsg by remember { mutableStateOf("") }
    var statusColor by remember { mutableStateOf(Color(0xFF4CAF50)) }

    var parseLoading by remember { mutableStateOf(false) }
    var videoInfo by remember { mutableStateOf<VideoInfo?>(null) }

    // 授权状态
    var licStatus by remember { mutableStateOf<LicenseStatus?>(null) }
    var showActivate by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        licStatus = license.computeStatus()
    }
    var quality by remember { mutableStateOf("best") }

    // 下载列表
    var downloadItems by remember { mutableStateOf(listOf<DownloadService.DownloadItem>()) }

    // 启动时检查 kill‑switch
    LaunchedEffect(Unit) {
        val s = RemoteSwitch.check(ctx)
        if (!s.ok) { blocked = true; blockMsg = s.msg; statusMsg = s.msg; statusColor = Color(0xFFFF5252) }
        else { statusMsg = "就绪"; statusColor = Color(0xFF4CAF50) }
    }

    Column(modifier = Modifier.fillMaxSize().background(Color(0xFF0F1117)).padding(16.dp).statusBarsPadding()) {

        // 标题行（右上角放设备码 + 激活）
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text("口语听力素材学习辅助工具", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("视频/音频下载", fontSize = 12.sp, color = Color(0xFF888899))
                Text("使用前请先登录个人账号", fontSize = 12.sp, color = Color(0xFF888899))
            }
            // 右上角设备码 + 激活按钮
            LicenseCorner(license, licStatus,
                onCopy = {
                    val s = licStatus?.deviceId ?: return@LicenseCorner
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("deviceId", s))
                    Toast.makeText(ctx, "设备码已复制", Toast.LENGTH_SHORT).show()
                },
                onActivate = { showActivate = true }
            )
        }
        Spacer(modifier = Modifier.height(8.dp))

        // kill‑switch 横幅
        if (blocked) {
            Surface(color = Color(0xFFB71C1C), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Text(blockMsg.ifEmpty { "软件已停止服务" }, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(12.dp))
            }
        }

        // 状态栏（可复制错误信息）
        SelectionContainer {
            Surface(color = Color(0xFF1A1D27), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text(statusMsg, color = statusColor, fontSize = 12.sp, modifier = Modifier.padding(10.dp))
            }
        }

        // YouTube 登录
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Text(if (hasCookies) "YouTube 已登录" else "YouTube 未登录 (点此登录)",
                color = if (hasCookies) Color(0xFF4CAF50) else Color(0xFFFFC107),
                fontSize = 12.sp)
            Spacer(modifier = Modifier.weight(1f))
            Surface(onClick = onLogin, color = if (hasCookies) Color(0xFF2E7D32) else Color(0xFF3F8CFF),
                shape = RoundedCornerShape(16.dp)) {
                Text(if (hasCookies) "重新登录" else "登录",
                    color = Color.White, fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            }
        }

        // URL 输入
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                placeholder = { Text("粘贴 YouTube 链接", color = Color(0xFF666677)) },
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                    focusedBorderColor = Color(0xFF3F8CFF), unfocusedBorderColor = Color(0xFF2A2D38),
                    cursorColor = Color(0xFF3F8CFF)
                ),
                singleLine = true
            )
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = {
                    if (url.isBlank() || blocked) return@Button
                    parseLoading = true
                    videoInfo = null
                    statusMsg = "解析中…"; statusColor = Color(0xFFFFC107)
                    scope.launch {
                        try {
                            val info = ytDlp.getVideoInfo(url.trim())
                            videoInfo = info
                            statusMsg = info.title; statusColor = Color(0xFF4CAF50)
                        } catch (e: Exception) {
                            val m = e.message ?: ""
                            if (m.contains("list index out of range") || m.contains("geo restrict") || m.contains("No media links")) {
                                statusMsg = "该资源不可用，请尝试 YouTube 上其他视频"
                            } else {
                                statusMsg = "解析失败：$m"
                            }
                            statusColor = Color(0xFFFF5252)
                        } finally { parseLoading = false }
                    }
                },
                enabled = !blocked && !parseLoading,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3F8CFF))
            ) { Text(if (parseLoading) "…" else "解析", color = Color.White) }
        }

        // 视频卡片
        if (videoInfo != null) {
            val info = videoInfo!!
            Surface(color = Color(0xFF1A1D27), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Row(modifier = Modifier.padding(10.dp)) {
                    AsyncImage(
                        model = info.thumbnail,
                        contentDescription = null,
                        modifier = Modifier.size(120.dp, 70.dp).clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(info.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                        Text(info.uploader, color = Color(0xFF888899), fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }

        // 画质选择
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
        ) {
            Text("画质：", color = Color(0xFF888899), fontSize = 13.sp)
            Spacer(modifier = Modifier.width(8.dp))
            listOf(
                "best" to "最佳", "1080" to "1080p", "720" to "720p",
                "480" to "480p", "audio" to "仅 MP3"
            ).forEach { (v, lbl) ->
                val selected = quality == v
                Surface(
                    color = if (selected) Color(0xFF3F8CFF) else Color(0xFF222530),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.padding(end = 6.dp),
                    onClick = { quality = v }
                ) {
                    Text(lbl, color = if (selected) Color.White else Color(0xFF777788),
                        fontSize = 12.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                }
            }
        }

        // 下载按钮
        Button(
            onClick = {
                if (url.isBlank() || blocked) return@Button
                // 授权门禁：未激活直接弹激活弹窗
                if (license.isLicensingEnabled() && !license.isLicensed()) {
                    showActivate = true
                    return@Button
                }
                val trimmed = url.trim()
                // 同链接已在下载中（非 done/error）就提示并跳过
                val dup = downloadItems.firstOrNull { it.url == trimmed && it.status != "done" && it.status != "error" }
                if (dup != null) {
                    statusMsg = "该链接已在下载列表中（${dup.status}）"
                    statusColor = Color(0xFFFFC107)
                    return@Button
                }
                scope.launch {
                    // 限次授权：扣次（不限次直接放行）
                    val (ok, reason) = license.beginDownload()
                    if (!ok) {
                        statusMsg = "下载被拒：$reason"
                        statusColor = Color(0xFFFF5252)
                        showActivate = true
                        return@launch
                    }
                    try {
                        statusMsg = "下载中…"; statusColor = Color(0xFFFFC107)
                        val item = DownloadService.DownloadItem(
                            id = System.currentTimeMillis().toString(),
                            url = trimmed,
                            title = videoInfo?.title ?: trimmed, status = "downloading"
                        )
                        downloadItems = downloadItems + item

                        val p = ytDlp.startDownload(trimmed, quality) { pct, sp, eta, st ->
                            // Python progress hook 跑在 IO 线程，切回 Main 改 Compose 状态
                            scope.launch {
                                val items = downloadItems.toMutableList()
                                val ix = items.indexOfFirst { it.id == item.id }
                                if (ix >= 0) {
                                    items[ix] = items[ix].copy(percent = pct, speed = sp, eta = eta, status = st)
                                    downloadItems = items.toList()
                                }
                                statusMsg = if (st == "processing") "处理中…" else "下载中 ${"%.1f".format(pct)}% $sp $eta"
                            }
                        }
                        val newItems = downloadItems.toMutableList()
                        val idx = newItems.indexOfFirst { it.id == item.id }
                        if (idx >= 0) {
                            newItems[idx] = newItems[idx].copy(
                                status = p.status, percent = p.percent,
                                speed = p.speed, size = p.size, eta = p.eta, error = p.error,
                                file = p.file
                            )
                        }
                        downloadItems = newItems.toList()
                        if (p.status == "done") {
                            val path = p.file ?: "/sdcard/Download/"
                            val dir = path.substringBeforeLast('/').ifEmpty { "/sdcard/Download" }
                            val name = path.substringAfterLast('/')
                            statusMsg = "下载完成: $name → $dir"
                            statusColor = Color(0xFF4CAF50)
                            Toast.makeText(ctx, "已保存到\n$path", Toast.LENGTH_LONG).show()
                        }
                        if (p.status == "error") {
                            statusMsg = "下载失败：${p.error}"; statusColor = Color(0xFFFF5252)
                            license.refund()  // 限次授权下载失败要退回次数
                        }
                    } catch (e: Exception) {
                        statusMsg = "下载失败：${e.message}"; statusColor = Color(0xFFFF5252)
                        license.refund()
                    }
                }
            },
            enabled = !blocked && url.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3F8CFF)),
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
        ) { Text("开始下载", color = Color.White) }

        // 下载列表
        Text("下载列表", color = Color(0xFF888899), fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp))
        LazyColumn(modifier = Modifier.weight(1f)) {
            if (downloadItems.isEmpty()) {
                item { Text("暂无下载任务", color = Color(0xFF555566), fontSize = 12.sp) }
            }
            items(downloadItems) { item ->
                Surface(
                    color = Color(0xFF1A1D27), shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(item.title, color = Color.White, fontSize = 13.sp, maxLines = 1)
                        Spacer(modifier = Modifier.height(4.dp))
                        // 进度条
                        LinearProgressIndicator(
                            progress = { item.percent / 100f },
                            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(4.dp)),
                            color = when (item.status) {
                                "done" -> Color(0xFF4CAF50)
                                "error" -> Color(0xFFFF5252)
                                else -> Color(0xFF3F8CFF)
                            },
                            trackColor = Color(0xFF11131A)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        val stateText = when (item.status) {
                            "done" -> "完成 → ${item.file ?: "/sdcard/Download/"}"
                            "error" -> "失败：${item.error ?: ""}"
                            "processing" -> "处理中…"
                            "downloading" -> "${"%.1f".format(item.percent)}% ${item.speed} ${item.eta}"
                            else -> "等待中…"
                        }
                        Text(stateText, color = Color(0xFF888899), fontSize = 11.sp, maxLines = 2)
                    }
                }
            }
        }
    }

    // 激活码输入弹窗
    if (showActivate) {
        ActivateDialog(
            current = licStatus,
            onDismiss = { showActivate = false },
            onSubmit = { key ->
                scope.launch {
                    statusMsg = "正在验证授权码…"; statusColor = Color(0xFFFFC107)
                    val r = license.activate(key)
                    licStatus = r
                    if (r.licensed) {
                        statusMsg = "授权成功 (到期 ${r.expiry.ifEmpty { "永久" }})"
                        statusColor = Color(0xFF4CAF50)
                        showActivate = false
                    } else {
                        statusMsg = "授权失败：${r.reason}"
                        statusColor = Color(0xFFFF5252)
                    }
                }
            }
        )
    }
}

@Composable
fun LicenseCorner(
    license: LicenseManager,
    status: LicenseStatus?,
    onCopy: () -> Unit,
    onActivate: () -> Unit
) {
    if (!license.isLicensingEnabled()) return
    val deviceId = status?.deviceId ?: license.getDeviceId()
    val licensed = status?.licensed == true
    Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 8.dp)) {
        // 设备码（短显示）
        Surface(
            color = Color(0xFF1A1D27),
            shape = RoundedCornerShape(6.dp),
            onClick = onCopy
        ) {
            Text(
                "ID ${deviceId.take(8)}…",
                color = Color(0xFFAAAABB),
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        // 激活状态
        Surface(
            color = if (licensed) Color(0xFF2E7D32) else Color(0xFFB71C1C),
            shape = RoundedCornerShape(6.dp),
            onClick = onActivate
        ) {
            Text(
                if (licensed) "已激活 →" else "未激活 · 点此激活",
                color = Color.White,
                fontSize = 10.sp,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

@Composable
fun ActivateDialog(
    current: LicenseStatus?,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit
) {
    val ctx = LocalContext.current
    var input by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("下载需要授权", color = Color.White) },
        text = {
            Column {
                Text(
                    "解析与预览免费；点下载需要授权码。",
                    color = Color(0xFFAAAABB), fontSize = 12.sp
                )
                Spacer(modifier = Modifier.height(10.dp))

                // 前去付费按钮（最显眼）
                Surface(
                    color = Color(0xFF3F8CFF),
                    shape = RoundedCornerShape(8.dp),
                    onClick = {
                        try {
                            val uri = android.net.Uri.parse("${LicenseManager.SERVER_URL}/recharge")
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            })
                        } catch (_: Exception) {
                            Toast.makeText(ctx, "无法打开浏览器", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "前去购买授权码 →",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(vertical = 10.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "微信/支付宝扫码付款后自动获得授权码",
                    color = Color(0xFF888899), fontSize = 10.sp
                )

                Spacer(modifier = Modifier.height(14.dp))
                Text(
                    "本机设备码（点击复制）：",
                    color = Color(0xFFAAAABB), fontSize = 12.sp
                )
                Spacer(modifier = Modifier.height(4.dp))
                Surface(
                    color = Color(0xFF11131A),
                    shape = RoundedCornerShape(6.dp),
                    onClick = {
                        val s = current?.deviceId ?: return@Surface
                        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("deviceId", s))
                        Toast.makeText(ctx, "设备码已复制", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    SelectionContainer {
                        Text(
                            current?.deviceId ?: "（设备码获取失败）",
                            color = Color.White,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(8.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))
                Text("已有授权码？粘贴这里：", color = Color(0xFFAAAABB), fontSize = 12.sp)
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    placeholder = { Text("VD-XXXX-XXXX-XXXX 或订单流水号", color = Color(0xFF666677)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFF3F8CFF), unfocusedBorderColor = Color(0xFF2A2D38),
                        cursorColor = Color(0xFF3F8CFF)
                    )
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(input) }, enabled = input.isNotBlank()) {
                Text("激活", color = Color(0xFF3F8CFF))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("稍后再说", color = Color(0xFF888899)) }
        },
        containerColor = Color(0xFF1A1D27)
    )
}

private fun darkColorScheme() = darkColorScheme(
    primary = Color(0xFF3F8CFF),
    surface = Color(0xFF0F1117),
    background = Color(0xFF0F1117),
    onPrimary = Color.White,
    onSurface = Color.White,
    onBackground = Color.White
)
