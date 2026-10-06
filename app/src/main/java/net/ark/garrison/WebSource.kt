package net.ark.garrison

import android.net.Uri
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale

data class WebSource(
    val name: String,
    val baseUrl: String,
    val builtIn: Boolean,
) {
    val id: String = sha256(baseUrl).take(24)
}

object SourceRegistry {
    const val APP_ID = "garrison-protocol"
    const val SHELL_VERSION = 1
    const val LEGACY_TITLE = "卫戍协议 · 联合防卫终端"

    val builtIns = listOf(
        WebSource("GitHub Pages", "https://yilegendoflink.github.io/garrison-protocol/", true),
        WebSource("Cloudflare Pages", "https://stronghold-protocol-web.pages.dev/", true),
    )

    fun custom(raw: String): WebSource {
        val normalized = normalizeBaseUrl(raw)
        if (builtIns.any { it.baseUrl.equals(normalized, ignoreCase = true) }) {
            return builtIns.first { it.baseUrl.equals(normalized, ignoreCase = true) }
        }
        return WebSource(Uri.parse(normalized).host ?: normalized, normalized, false)
    }

    fun normalizeBaseUrl(raw: String): String {
        val trimmed = raw.trim()
        val uri = Uri.parse(trimmed)
        require(uri.scheme.equals("https", true)) { "来源必须使用 HTTPS。" }
        require(!uri.host.isNullOrBlank()) { "请输入完整的网址，例如 https://example.com/。" }
        require(uri.userInfo == null) { "网址不能包含账号或密码。" }
        require(uri.port == -1 || uri.port == 443) { "来源必须使用标准 HTTPS 端口。" }
        require(uri.query == null && uri.fragment == null) { "来源地址不能包含查询参数或片段。" }

        val decodedPath = Uri.decode(uri.encodedPath ?: "/")
        require(decodedPath.split('/').none { it == ".." || it == "." }) { "来源路径无效。" }
        val path = if (decodedPath.endsWith("/index.html", true)) {
            decodedPath.removeSuffix("index.html")
        } else if (decodedPath.endsWith('/')) {
            decodedPath
        } else {
            "$decodedPath/"
        }
        val normalized = uri.buildUpon()
            .scheme("https")
            .path(path)
            .clearQuery()
            .fragment(null)
            .build()
            .toString()
        require(normalized.length <= 512) { "来源网址过长。" }
        return normalized
    }

    fun allows(source: WebSource, candidate: Uri): Boolean {
        if (!candidate.scheme.equals("https", true)) return false
        if (!candidate.userInfo.isNullOrEmpty()) return false
        if (candidate.port != -1 && candidate.port != 443) return false
        val base = Uri.parse(source.baseUrl)
        if (!candidate.host.equals(base.host, true)) return false
        val basePath = Uri.decode(base.encodedPath ?: "/")
        val requestPath = Uri.decode(candidate.encodedPath ?: "/")
        if (basePath.contains('\\') || requestPath.contains('\\')) return false
        if (hasTraversal(basePath) || hasTraversal(requestPath)) return false
        return requestPath.startsWith(basePath)
    }

    private fun hasTraversal(path: String): Boolean = path.split('/').any { segment ->
        var decoded = segment
        repeat(3) {
            if (decoded == "." || decoded == "..") return true
            val next = Uri.decode(decoded)
            if (next == decoded) return@repeat
            decoded = next
        }
        decoded == "." || decoded == ".."
    }

    fun hasHomeMarker(source: WebSource, html: String): Boolean {
        val meta = metaTags(html)
        val appId = meta["garrison-app-id"]
        val shell = meta["garrison-app-shell"]?.toIntOrNull()
        if (appId == APP_ID && shell == SHELL_VERSION) return true

        // The current Cloudflare deployment predates the explicit meta marker.
        // Keep the two pinned built-ins usable during rollout; custom sources need
        // the explicit marker so an unrelated page cannot be added by URL alone.
        if (!source.builtIn) return false
        val title = Regex("(?is)<title\\b[^>]*>(.*?)</title>")
            .find(html)?.groupValues?.get(1)?.replace(Regex("<[^>]+>"), "")?.trim()
        return title == LEGACY_TITLE &&
            Regex("(?is)id\\s*=\\s*['\"]boot-screen['\"]").containsMatchIn(html) &&
            Regex("(?is)id\\s*=\\s*['\"]app['\"]").containsMatchIn(html) &&
            Regex("(?i)native\\.bundle\\.js").containsMatchIn(html)
    }

    fun metaTags(html: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val tagRegex = Regex("(?is)<meta\\b([^>]*)>")
        val attrRegex = Regex("(?is)([\\w:-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))")
        for (tag in tagRegex.findAll(html)) {
            val attrs = mutableMapOf<String, String>()
            for (attr in attrRegex.findAll(tag.groupValues[1])) {
                val value = (1..3).map { attr.groupValues[it] }.firstOrNull { it.isNotEmpty() }.orEmpty()
                attrs[attr.groupValues[1].lowercase(Locale.ROOT)] = value
            }
            val name = attrs["name"]?.lowercase(Locale.ROOT)
            val content = attrs["content"]
            if (name != null && content != null) result[name] = content
        }
        return result
    }
}

data class VerifiedHome(
    val url: String,
    val html: ByteArray,
    val mimeType: String,
    val charset: String?,
    val etag: String?,
    val lastModified: String?,
)

object SourceProbe {
    private const val MAX_HOME_BYTES = 2 * 1024 * 1024

    @Throws(IOException::class)
    fun verify(source: WebSource): VerifiedHome {
        var current = URL(source.baseUrl)
        repeat(5) {
            if (!SourceRegistry.allows(source, Uri.parse(current.toString()))) {
                throw IOException("首页跳转到了来源范围之外，已阻止加载。")
            }
            val connection = current.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 18_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml")
            connection.setRequestProperty("Accept-Encoding", "identity")
            try {
                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("首页返回了无效跳转。")
                    current = URL(current, location)
                    return@repeat
                }
                if (code != HttpURLConnection.HTTP_OK) throw IOException("首页返回 HTTP $code。")
                val length = connection.contentLengthLong
                if (length > MAX_HOME_BYTES) throw IOException("首页文件超出大小限制。")
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    var total = 0
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_HOME_BYTES) throw IOException("首页文件超出大小限制。")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val contentType = connection.contentType ?: "text/html; charset=utf-8"
                val charset = Regex("(?i)charset=([^;]+)").find(contentType)?.groupValues?.get(1)?.trim()?.trim('"')
                val html = bytes.toString(Charsets.UTF_8)
                if (!SourceRegistry.hasHomeMarker(source, html)) {
                    throw InvalidSourceException("首页标记不匹配：这个网址不是受支持的卫戍协议网页。")
                }
                return VerifiedHome(
                    current.toString(), bytes, contentType.substringBefore(';').trim(), charset,
                    connection.getHeaderField("ETag"), connection.getHeaderField("Last-Modified"),
                )
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("首页跳转次数过多。")
    }

    @Throws(IOException::class)
    fun fetchAsset(source: WebSource, address: String, expectedSize: Long): ByteArray {
        var current = URL(address)
        repeat(5) {
            if (!SourceRegistry.allows(source, Uri.parse(current.toString()))) {
                throw InvalidSourceException("资源跳转到了来源范围之外，已阻止下载。")
            }
            val connection = current.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept-Encoding", "identity")
            try {
                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("资源返回了无效跳转。")
                    current = URL(current, location)
                    return@repeat
                }
                if (code != HttpURLConnection.HTTP_OK) throw IOException("资源返回 HTTP $code。")
                if (connection.contentLengthLong > MAX_ASSET_BYTES || expectedSize > MAX_ASSET_BYTES) {
                    throw IOException("单个资源超过缓存大小限制。")
                }
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(32 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_ASSET_BYTES) throw IOException("单个资源超过缓存大小限制。")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                if (expectedSize >= 0 && bytes.size.toLong() != expectedSize) throw IOException("资源大小与清单不一致。")
                return bytes
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("资源跳转次数过多。")
    }

    class InvalidSourceException(message: String) : IOException(message)

    private const val MAX_ASSET_BYTES = 80L * 1024L * 1024L
}

internal fun sha256(value: String): String = sha256(value.toByteArray(Charsets.UTF_8))

internal fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { "%02x".format(it) }
