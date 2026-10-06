package net.ark.garrison

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLException

/** App-owned disk cache for resources fetched from a validated site origin. */
class PersistentAssetCache(context: Context) {
    private val root = File(context.filesDir, "site-cache-v1").apply { mkdirs() }
    private val locks = ConcurrentHashMap<String, Any>()
    @Volatile private var offlineMode = false

    fun useOfflineMode() { offlineMode = true }
    fun useOnlineMode() { offlineMode = false }

    data class Entry(
        val file: File,
        val mimeType: String,
        val charset: String?,
        val etag: String?,
        val lastModified: String?,
        val sha256: String,
    )

    fun rememberHome(source: WebSource, home: VerifiedHome) {
        write(source, home.url, home.html, home.mimeType, home.charset, home.etag, home.lastModified)
        if (home.url != source.baseUrl) {
            write(source, source.baseUrl, home.html, home.mimeType, home.charset, home.etag, home.lastModified)
        }
    }

    fun rememberAsset(source: WebSource, url: String, bytes: ByteArray, mimeType: String) {
        val charset = if (mimeType.startsWith("text/") || mimeType == "application/json" || mimeType.contains("javascript")) "UTF-8" else null
        write(source, url, bytes, mimeType, charset, null, null)
    }

    fun cached(source: WebSource, url: String): Entry? = read(source, url)

    fun cacheStats(source: WebSource): Pair<Int, Long> {
        val folder = sourceFolder(source)
        if (!folder.exists()) return 0 to 0L
        val files = folder.walkTopDown().filter { it.isFile && it.name == "body" }.toList()
        return files.size to files.sumOf { it.length() }
    }

    fun clear(source: WebSource) {
        val folder = sourceFolder(source)
        if (folder.canonicalPath.startsWith(root.canonicalPath + File.separator)) folder.deleteRecursively()
    }

    fun intercept(request: WebResourceRequest, source: WebSource): WebResourceResponse {
        val uri = request.url
        if (!SourceRegistry.allows(source, uri)) return error(403, "Forbidden", "已阻止加载来源范围之外的内容。")
        if (request.method != "GET") return error(405, "Method Not Allowed", "此网页容器只允许读取静态页面资源。")

        val url = uri.toString()
        val previous = read(source, url)
        if (offlineMode) {
            return previous?.let { response(it) } ?: error(504, "Gateway Timeout", "此资源尚未缓存，当前无法连接来源网站。")
        }
        return try {
            val fresh = fetch(source, url, previous)
            val contentType = fresh.first
            val charset = fresh.second
            val etag = fresh.third
            val modified = fresh.fourth
            val bytes = fresh.fifth
            if (request.isForMainFrame && contentType.startsWith("text/html", true)) {
                val html = bytes.toString(Charsets.UTF_8)
                if (!SourceRegistry.hasHomeMarker(source, html)) {
                    return error(403, "Forbidden", "首页标记不匹配，已阻止显示。")
                }
            }
            val entry = write(source, url, bytes, contentType, charset, etag, modified)
            response(entry)
        } catch (invalid: SourceProbe.InvalidSourceException) {
            error(403, "Forbidden", invalid.message ?: "首页标记不匹配。")
        } catch (_: SSLException) {
            error(495, "TLS Certificate Error", "来源 HTTPS 证书无效，已拒绝加载。")
        } catch (_: Exception) {
            // A single missing or transiently failed asset must not switch every
            // later request to offline mode. Only homepage verification decides
            // whether the whole source should be loaded offline.
            val cached = read(source, url)
            if (cached != null) {
                if (request.isForMainFrame && cached.mimeType.startsWith("text/html", true)) {
                    val html = cached.file.readText(Charsets.UTF_8)
                    if (!SourceRegistry.hasHomeMarker(source, html)) {
                        return error(403, "Forbidden", "缓存首页标记无效，已阻止显示。")
                    }
                }
                response(cached)
            } else {
                error(504, "Gateway Timeout", "此资源尚未缓存，当前无法连接来源网站。")
            }
        }
    }

    private fun fetch(source: WebSource, requestedUrl: String, previous: Entry?): Quintuple<String, String?, String?, String?, ByteArray> {
        var current = URL(requestedUrl)
        repeat(5) {
            if (!SourceRegistry.allows(source, Uri.parse(current.toString()))) {
                throw SourceProbe.InvalidSourceException("资源跳转到了来源范围之外，已阻止加载。")
            }
            val connection = current.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 25_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setRequestProperty("Accept", "text/html,application/javascript,text/css,application/json,image/*,font/*,*/*;q=0.8")
            if (current.toString() == requestedUrl) {
                previous?.etag?.let { connection.setRequestProperty("If-None-Match", it) }
                previous?.lastModified?.let { connection.setRequestProperty("If-Modified-Since", it) }
            }
            try {
                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("资源返回了无效跳转。")
                    current = URL(current, location)
                    return@repeat
                }
                if (code == HttpURLConnection.HTTP_NOT_MODIFIED && previous != null) {
                    return Quintuple(previous.mimeType, previous.charset, previous.etag, previous.lastModified, previous.file.readBytes())
                }
                if (code != HttpURLConnection.HTTP_OK) throw IOException("资源返回 HTTP $code。")
                val contentLength = connection.contentLengthLong
                if (contentLength > MAX_ENTRY_BYTES) throw IOException("单个网页资源超过缓存大小限制。")
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream(if (contentLength in 0L..MAX_MEMORY_BUFFER) contentLength.toInt() else 16 * 1024)
                    val buffer = ByteArray(32 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_ENTRY_BYTES) throw IOException("单个网页资源超过缓存大小限制。")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val contentType = connection.contentType?.substringBefore(';')?.trim()?.takeIf { it.isNotEmpty() }
                    ?: mimeFromPath(current.path)
                val charset = Regex("(?i)charset=([^;]+)").find(connection.contentType.orEmpty())
                    ?.groupValues?.get(1)?.trim()?.trim('"')
                return Quintuple(contentType, charset, connection.getHeaderField("ETag"), connection.getHeaderField("Last-Modified"), bytes)
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("资源跳转次数过多。")
    }

    private fun write(
        source: WebSource,
        url: String,
        bytes: ByteArray,
        mimeType: String,
        charset: String?,
        etag: String?,
        lastModified: String?,
    ): Entry {
        val key = sha256(url)
        val lock = locks.getOrPut(source.id + key) { Any() }
        synchronized(lock) {
            val directory = File(sourceFolder(source), key).apply { mkdirs() }
            val body = File(directory, "body")
            val temp = File(directory, "body.tmp-${Thread.currentThread().id}")
            temp.writeBytes(bytes)
            if (!temp.renameTo(body)) {
                temp.copyTo(body, overwrite = true)
                temp.delete()
            }
            val hash = sha256(bytes)
            val metadata = JSONObject()
                .put("url", url)
                .put("mimeType", mimeType)
                .put("charset", charset)
                .put("etag", etag)
                .put("lastModified", lastModified)
                .put("sha256", hash)
                .put("savedAt", System.currentTimeMillis())
            File(directory, "metadata.json").writeText(metadata.toString(), Charsets.UTF_8)
            body.setLastModified(System.currentTimeMillis())
            trimIfNeeded()
            return Entry(body, mimeType, charset, etag, lastModified, hash)
        }
    }

    private fun read(source: WebSource, url: String): Entry? {
        val directory = File(sourceFolder(source), sha256(url))
        val body = File(directory, "body")
        val metadata = File(directory, "metadata.json")
        if (!body.isFile || !metadata.isFile) return null
        return try {
            val json = JSONObject(metadata.readText(Charsets.UTF_8))
            if (json.optString("url") != url) return null
            body.setLastModified(System.currentTimeMillis())
            Entry(
                body,
                json.optString("mimeType", "application/octet-stream"),
                json.optString("charset").takeIf { it.isNotEmpty() },
                json.optString("etag").takeIf { it.isNotEmpty() },
                json.optString("lastModified").takeIf { it.isNotEmpty() },
                json.optString("sha256"),
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun response(entry: Entry): WebResourceResponse {
        val headers = mapOf(
            "Cache-Control" to "no-store",
            "X-Content-Type-Options" to "nosniff",
        )
        return WebResourceResponse(entry.mimeType, entry.charset, 200, "OK", headers, entry.file.inputStream())
    }

    private fun error(status: Int, reason: String, message: String) = WebResourceResponse(
        "text/plain", "UTF-8", status, reason, mapOf("Cache-Control" to "no-store"),
        message.byteInputStream(Charsets.UTF_8),
    )

    private fun sourceFolder(source: WebSource) = File(root, source.id)

    private fun trimIfNeeded() {
        val bodies = root.walkTopDown().filter { it.isFile && it.name == "body" }.toList()
        var total = bodies.sumOf { it.length() }
        if (total <= MAX_CACHE_BYTES) return
        for (body in bodies.sortedBy { it.lastModified() }) {
            if (total <= MAX_CACHE_BYTES) break
            val dir = body.parentFile ?: continue
            val size = body.length()
            dir.deleteRecursively()
            total -= size
        }
    }

    private fun mimeFromPath(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "css" -> "text/css"
        "js", "mjs" -> "text/javascript"
        "json" -> "application/json"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "svg" -> "image/svg+xml"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ttf" -> "font/ttf"
        "mp3" -> "audio/mpeg"
        "ogg" -> "audio/ogg"
        else -> "application/octet-stream"
    }

    private data class Quintuple<A, B, C, D, E>(val first: A, val second: B, val third: C, val fourth: D, val fifth: E)

    companion object {
        private const val MAX_ENTRY_BYTES = 80L * 1024L * 1024L
        private const val MAX_MEMORY_BUFFER = 512L * 1024L
        private const val MAX_CACHE_BYTES = 768L * 1024L * 1024L
    }
}
