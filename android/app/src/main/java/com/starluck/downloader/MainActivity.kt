package com.starluck.downloader

import android.content.Intent
import android.os.Bundle
import android.os.Environment
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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

class MainActivity : ComponentActivity() {

    private val ytDlp = lazy { YtDlpRunner(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme()
            ) {
                MainScreen(ytDlp)
            }
        }
    }
}

@Composable
fun MainScreen(ytDlp: Lazy<YtDlpRunner>) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    var url by remember { mutableStateOf("") }
    var blocked by remember { mutableStateOf(false) }
    var blockMsg by remember { mutableStateOf("") }
    var statusMsg by remember { mutableStateOf("") }
    var statusColor by remember { mutableStateOf(Color(0xFF4CAF50)) }

    var parseLoading by remember { mutableStateOf(false) }
    var videoInfo by remember { mutableStateOf<VideoInfo?>(null) }
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

        // 标题
        Text("口语听力素材学习辅助工具", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("YouTube · 哔哩哔哩 · 免费下载", fontSize = 13.sp, color = Color(0xFF888899), modifier = Modifier.padding(bottom = 8.dp))

        // kill‑switch 横幅
        if (blocked) {
            Surface(color = Color(0xFFB71C1C), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Text(blockMsg.ifEmpty { "软件已停止服务" }, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(12.dp))
            }
        }

        // 状态栏
        Surface(color = Color(0xFF1A1D27), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Text(statusMsg, color = statusColor, fontSize = 12.sp, modifier = Modifier.padding(10.dp))
        }

        // URL 输入
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                placeholder = { Text("粘贴 YouTube / B站 链接", color = Color(0xFF666677)) },
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
                            val info = ytDlp.value.getVideoInfo(url.trim())
                            videoInfo = info
                            statusMsg = info.title; statusColor = Color(0xFF4CAF50)
                        } catch (e: Exception) {
                            val m = e.message ?: ""
                            if (m.contains("list index out of range") || m.contains("geo restrict") || m.contains("No media links")) {
                                statusMsg = "本歌曲飞走了，建议使用B站或YouTube搜索并下载仅MP3"
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
                scope.launch {
                    try {
                        statusMsg = "下载中…"; statusColor = Color(0xFFFFC107)
                        val item = DownloadService.DownloadItem(
                            id = System.currentTimeMillis().toString(),
                            title = videoInfo?.title ?: url, status = "downloading"
                        )
                        downloadItems = downloadItems + item

                        ytDlp.value.startDownload(url.trim(), quality).collect { p ->
                            val newItems = downloadItems.toMutableList()
                            val idx = newItems.indexOfFirst { it.id == item.id }
                            if (idx >= 0) {
                                newItems[idx] = newItems[idx].copy(
                                    status = p.status, percent = p.percent,
                                    speed = p.speed, size = p.size, eta = p.eta, error = p.error
                                )
                            }
                            downloadItems = newItems.toList()

                            if (p.status == "done") { statusMsg = "下载完成"; statusColor = Color(0xFF4CAF50) }
                            if (p.status == "error") { statusMsg = "下载失败"; statusColor = Color(0xFFFF5252) }
                        }
                    } catch (e: Exception) {
                        statusMsg = "下载失败：${e.message}"; statusColor = Color(0xFFFF5252)
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
                            "done" -> "完成"
                            "error" -> "失败：${item.error ?: ""}"
                            "processing" -> "处理中…"
                            "downloading" -> "${"%.1f".format(item.percent)}% ${item.speed} ${item.eta}"
                            else -> "等待中…"
                        }
                        Text(stateText, color = Color(0xFF888899), fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

private fun darkColorScheme() = darkColorScheme(
    primary = Color(0xFF3F8CFF),
    surface = Color(0xFF0F1117),
    background = Color(0xFF0F1117),
    onPrimary = Color.White,
    onSurface = Color.White,
    onBackground = Color.White
)
