package com.starluck.downloader

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.TimeUnit

data class LicenseStatus(
    val enabled: Boolean,
    val licensed: Boolean,
    val reason: String,
    val expiry: String,
    val deviceId: String,
    val quota: Int? = null,
    val remaining: Int? = null,
)

/**
 * 与 PC 端 src/license.ts 对齐：设备指纹 + Ed25519 验签 + /verify /consume /refund。
 * 服务器签名消息格式必须与 PC 端完全一致：
 *   verify:  key|deviceId|valid|expiry|nonce|serverTime
 *   consume: key|deviceId|ok|remaining|nonce|serverTime
 */
class LicenseManager(private val ctx: Context) {

    companion object {
        // ===== 与 PC 端 src/license.ts 同步 =====
        const val SERVER_URL = "https://license-videodownload.justsaysayforfun.com"
        const val GRACE_DAYS = 7
        // 与服务器 private.pem 配对的 Ed25519 公钥（DER base64，去掉 PEM 头尾后的中间一行）
        const val PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAuemEb6vqFfhcaAzB3fsILdSaX7OobiZAeboYj26wk08="
        // =======================================

        init {
            try {
                Security.removeProvider("BC")
                Security.addProvider(BouncyCastleProvider())
            } catch (_: Exception) {}
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val statePath = File(ctx.filesDir, "license.json")
    private val licensingEnabled: Boolean = SERVER_URL.isNotBlank() && PUBLIC_KEY_B64.isNotBlank()
    @Volatile private var cachedLicensed: Boolean = !licensingEnabled
    @Volatile private var lastQuota: Int? = null
    @Volatile private var lastRemaining: Int? = null

    fun isLicensed(): Boolean = cachedLicensed
    fun isLicensingEnabled(): Boolean = licensingEnabled
    fun lastQuotaValue(): Int? = lastQuota
    fun lastRemainingValue(): Int? = lastRemaining

    /** PC 用 MAC+hostname，Android 上 MAC 受限；用 ANDROID_ID + 设备型号代替。 */
    fun getDeviceId(): String {
        val androidId = try {
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (_: Exception) { null } ?: "no-android-id"
        val basis = "$androidId|${Build.MANUFACTURER}|${Build.MODEL}"
        val digest = MessageDigest.getInstance("SHA-256").digest(basis.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(32)
    }

    private fun loadState(): JSONObject {
        return try {
            if (statePath.exists()) JSONObject(statePath.readText()) else JSONObject()
        } catch (_: Exception) { JSONObject() }
    }

    private fun saveState(key: String, expiry: String, checkedAt: Long) {
        try {
            val o = JSONObject()
            o.put("key", key)
            val lg = JSONObject()
            lg.put("expiry", expiry)
            lg.put("checkedAt", checkedAt)
            o.put("lastGood", lg)
            statePath.writeText(o.toString(2))
        } catch (_: Exception) {}
    }

    private fun verifyEd25519(message: ByteArray, sigB64: String): Boolean {
        return try {
            val keyBytes = Base64.decode(PUBLIC_KEY_B64, Base64.DEFAULT)
            val spec = X509EncodedKeySpec(keyBytes)
            val kf = KeyFactory.getInstance("Ed25519", "BC")
            val pub = kf.generatePublic(spec)
            val sig = Signature.getInstance("Ed25519", "BC")
            sig.initVerify(pub)
            sig.update(message)
            sig.verify(Base64.decode(sigB64, Base64.DEFAULT))
        } catch (_: Exception) { false }
    }

    private fun verifySig(res: JSONObject, key: String, deviceId: String, nonce: String): Boolean {
        val msg = listOf(
            key, deviceId,
            res.optBoolean("valid").toString(),
            res.optString("expiry", ""),
            nonce,
            res.optLong("serverTime", 0L).toString()
        ).joinToString("|")
        return verifyEd25519(msg.toByteArray(Charsets.UTF_8), res.optString("sig", ""))
    }

    private fun verifyConsumeSig(res: JSONObject, key: String, deviceId: String, nonce: String): Boolean {
        val msg = listOf(
            key, deviceId,
            res.optBoolean("ok").toString(),
            res.optInt("remaining").toString(),
            nonce,
            res.optLong("serverTime", 0L).toString()
        ).joinToString("|")
        return verifyEd25519(msg.toByteArray(Charsets.UTF_8), res.optString("sig", ""))
    }

    private fun postJson(path: String, body: JSONObject): JSONObject? {
        return try {
            val req = Request.Builder()
                .url("$SERVER_URL$path")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.string()?.let { JSONObject(it) }
            }
        } catch (_: Exception) { null }
    }

    private fun randomNonce(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun verifyOnline(key: String): JSONObject? {
        val deviceId = getDeviceId()
        val nonce = randomNonce()
        val body = JSONObject().apply {
            put("key", key); put("deviceId", deviceId); put("nonce", nonce)
        }
        val res = postJson("/verify", body) ?: return null
        if (!verifySig(res, key, deviceId, nonce)) {
            // 签名无效 → 视为无效响应
            val fake = JSONObject()
            fake.put("valid", false)
            fake.put("reason", "响应签名无效")
            return fake
        }
        return res
    }

    suspend fun computeStatus(): LicenseStatus = withContext(Dispatchers.IO) {
        val deviceId = getDeviceId()
        if (!licensingEnabled) {
            cachedLicensed = true
            return@withContext LicenseStatus(false, true, "", "", deviceId)
        }
        val state = loadState()
        val key = state.optString("key", "")
        if (key.isEmpty()) {
            cachedLicensed = false
            return@withContext LicenseStatus(true, false, "请输入授权码", "", deviceId)
        }
        val res = verifyOnline(key)
        if (res != null) {
            val valid = res.optBoolean("valid", false)
            val expiry = res.optString("expiry", "")
            val quota = if (res.has("quota") && !res.isNull("quota")) res.optInt("quota") else null
            val remaining = if (res.has("remaining") && !res.isNull("remaining")) res.optInt("remaining") else null
            if (valid) {
                saveState(key, expiry, System.currentTimeMillis())
                cachedLicensed = true
                lastQuota = quota
                lastRemaining = remaining
                return@withContext LicenseStatus(true, true, "", expiry, deviceId, quota, remaining)
            }
            cachedLicensed = false
            return@withContext LicenseStatus(true, false, res.optString("reason", "授权无效"),
                expiry, deviceId, quota, remaining)
        }
        // 网络失败 → 走宽容期
        val lg = state.optJSONObject("lastGood")
        if (lg != null) {
            val checkedAt = lg.optLong("checkedAt", 0L)
            val expiry = lg.optString("expiry", "")
            val withinGrace = (System.currentTimeMillis() - checkedAt) <= GRACE_DAYS * 86400_000L
            val notExpired = expiry.isEmpty() || parseDate(expiry) >= System.currentTimeMillis()
            if (withinGrace && notExpired) {
                cachedLicensed = true
                return@withContext LicenseStatus(true, true, "离线宽容期", expiry, deviceId)
            }
        }
        cachedLicensed = false
        LicenseStatus(true, false, "无法连接授权服务器，请联网后重试",
            lg?.optString("expiry", "") ?: "", deviceId)
    }

    suspend fun activate(rawKey: String): LicenseStatus = withContext(Dispatchers.IO) {
        val deviceId = getDeviceId()
        if (!licensingEnabled) {
            cachedLicensed = true
            return@withContext LicenseStatus(false, true, "", "", deviceId)
        }
        val key = rawKey.trim()
        if (key.isEmpty()) {
            return@withContext LicenseStatus(true, false, "请输入授权码", "", deviceId)
        }
        val res = verifyOnline(key) ?: run {
            cachedLicensed = false
            return@withContext LicenseStatus(true, false,
                "无法连接授权服务器，请检查网络", "", deviceId)
        }
        val valid = res.optBoolean("valid", false)
        val expiry = res.optString("expiry", "")
        val quota = if (res.has("quota") && !res.isNull("quota")) res.optInt("quota") else null
        val remaining = if (res.has("remaining") && !res.isNull("remaining")) res.optInt("remaining") else null
        if (valid) {
            saveState(key, expiry, System.currentTimeMillis())
            cachedLicensed = true
            lastQuota = quota
            lastRemaining = remaining
            return@withContext LicenseStatus(true, true, "", expiry, deviceId, quota, remaining)
        }
        cachedLicensed = false
        LicenseStatus(true, false, res.optString("reason", "授权无效"), expiry, deviceId, quota, remaining)
    }

    /** 下载门禁：不限次的码直接放行；有额度的码联网扣次。返回 ok / 原因。 */
    suspend fun beginDownload(): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (!licensingEnabled) return@withContext true to ""
        if (!cachedLicensed) return@withContext false to "未授权或授权已过期"
        if (lastQuota == null) return@withContext true to ""  // 不限次
        val state = loadState()
        val key = state.optString("key", "")
        if (key.isEmpty()) return@withContext false to "未授权"
        val deviceId = getDeviceId()
        val nonce = randomNonce()
        val body = JSONObject().apply {
            put("key", key); put("deviceId", deviceId); put("nonce", nonce)
        }
        val res = postJson("/consume", body)
            ?: return@withContext false to "无法连接授权服务器（按次数授权需联网）"
        if (!verifyConsumeSig(res, key, deviceId, nonce)) {
            return@withContext false to "扣次响应签名无效"
        }
        val ok = res.optBoolean("ok", false)
        val remaining = if (res.has("remaining") && !res.isNull("remaining")) res.optInt("remaining") else null
        lastRemaining = remaining
        ok to (res.optString("reason", "").ifEmpty { if (ok) "" else "扣次失败" })
    }

    suspend fun refund() = withContext(Dispatchers.IO) {
        if (!licensingEnabled) return@withContext
        val state = loadState()
        val key = state.optString("key", "")
        if (key.isEmpty()) return@withContext
        val deviceId = getDeviceId()
        val nonce = randomNonce()
        val body = JSONObject().apply {
            put("key", key); put("deviceId", deviceId); put("nonce", nonce)
        }
        postJson("/refund", body)  // best-effort
    }

    private fun parseDate(s: String): Long {
        return try {
            // 服务器返回 ISO 日期或 YYYY-MM-DD
            val fmt = if (s.contains("T")) java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
                     else java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            fmt.parse(s)?.time ?: Long.MAX_VALUE
        } catch (_: Exception) { Long.MAX_VALUE }
    }
}
