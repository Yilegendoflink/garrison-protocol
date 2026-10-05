package net.ark.garrison

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLException

class MainActivity : Activity() {
    private lateinit var sourcePrefs: SourcePreferences
    private lateinit var assetCache: PersistentAssetCache
    private val background: ExecutorService = Executors.newSingleThreadExecutor()
    private val assetSync: ExecutorService = Executors.newSingleThreadExecutor()
    private val assetSyncGeneration = AtomicLong(0L)
    @Volatile private var source: WebSource? = null
    private var webView: WebView? = null
    private var webContainer: FrameLayout? = null
    private var sourceButton: TextView? = null
    private var sourceGroup: RadioGroup? = null
    private var sourceStatus: TextView? = null
    private var urlInput: EditText? = null
    private var playMode = false
    private var settingsOpen = false
    private var resumePlayMode = false
    private var pendingExport: ByteArray? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        applySystemBars()
        sourcePrefs = SourcePreferences(this)
        assetCache = PersistentAssetCache(this)
        val savedSource = sourcePrefs.selectedSource()
        if (savedSource == null) {
            showSourceChooser("首次启动请选择并验证网页来源。")
        } else {
            showStartupScreen(savedSource)
            openSelectedSource(savedSource)
        }
    }

    override fun onDestroy() {
        assetSyncGeneration.incrementAndGet()
        assetSync.shutdownNow()
        background.shutdownNow()
        destroyWebView()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        applySystemBars()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applySystemBars()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (settingsOpen) {
            returnToWebPage()
            return
        }
        val currentWebView = webView
        if (currentWebView == null) {
            super.onBackPressed()
            return
        }
        if (playMode) {
            currentWebView.evaluateJavascript("document.querySelector('[data-act=\\\"home\\\"]')?.click()", null)
            setPlayMode(false)
        } else {
            showSourceChooser("已返回来源选择。对局和浏览器内存档均保留。")
        }
    }

    private fun openWebSettings() {
        if (webView == null) return
        resumePlayMode = playMode
        settingsOpen = true
        showSourceChooser("选择并验证要打开的网页来源。", keepCurrentWebView = true)
    }

    private fun returnToWebPage() {
        val currentSource = source
        if (currentSource != null) sourcePrefs.setSelected(currentSource.id)
        settingsOpen = false
        sourceGroup = null
        sourceStatus = null
        urlInput = null
        webContainer?.let { setContentView(it) }
        setPlayMode(resumePlayMode)
    }

    private fun showStartupScreen(selected: WebSource) {
        val screen = FrameLayout(this).apply { setBackgroundColor(Color.rgb(8, 21, 25)) }
        val message = text("正在打开 ${selected.name}……", 18, Color.rgb(192, 225, 213), true).apply {
            gravity = Gravity.CENTER
        }
        screen.addView(message, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        ))
        setContentView(screen)
    }

    private fun showSourceChooser(message: String? = null, keepCurrentWebView: Boolean = false) {
        setPlayMode(false)
        if (!keepCurrentWebView) {
            settingsOpen = false
            destroyWebView()
            source = null
        }

        val scroll = ScrollView(this).apply { setBackgroundColor(Color.rgb(8, 21, 25)) }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(24), dp(22), dp(28))
        }
        scroll.addView(content)
        content.addView(text("卫戍协议 Android", 26, Color.rgb(234, 250, 243), true))
        if (keepCurrentWebView) {
            content.addView(button("返回当前网页") { returnToWebPage() })
        }
        content.addView(text("首次启动请选择网页来源；之后 App 会自动打开上次使用的来源。网页打开后会在后台检查并缓存静态资源，完成后自动改用本地资源，不会重载或中断当前游戏。", 14, Color.rgb(145, 182, 173)))
        sourceStatus = text(message.orEmpty(), 13, Color.rgb(121, 220, 183)).also {
            it.setPadding(0, dp(14), 0, dp(8))
        }
        content.addView(sourceStatus)

        sourceGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        val sources = sourcePrefs.sources()
        val selected = sourcePrefs.selectedId()
        sources.forEach { item ->
            val radio = RadioButton(this).apply {
                id = View.generateViewId()
                tag = item.id
                text = "${item.name}\n${item.baseUrl}"
                textSize = 13f
                setTextColor(Color.rgb(220, 233, 229))
                isChecked = item.id == selected
                setPadding(dp(2), dp(7), dp(2), dp(7))
            }
            sourceGroup?.addView(radio)
        }
        content.addView(sourceGroup)
        sources.filterNot { it.builtIn }.forEach { item ->
            val isCurrentSource = keepCurrentWebView && source?.id == item.id
            content.addView(Button(this).apply {
                text = if (isCurrentSource) "当前正在使用：${item.name}（切换后可移除）" else "移除自定义来源：${item.name}"
                isEnabled = !isCurrentSource
                setOnClickListener {
                    sourcePrefs.removeCustom(item)
                    showSourceChooser("已移除自定义来源。", keepCurrentWebView = keepCurrentWebView)
                }
            })
        }
        sourceGroup?.setOnCheckedChangeListener { group, checkedId ->
            refreshCacheStatus()
        }

        content.addView(text("添加自定义来源", 17, Color.rgb(234, 250, 243), true).apply {
            setPadding(0, dp(14), 0, dp(4))
        })
        val customRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        urlInput = EditText(this).apply {
            hint = "https://example.com/"
            setSingleLine(true)
            textSize = 14f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.rgb(16, 39, 42))
        }
        customRow.addView(urlInput, LinearLayout.LayoutParams(0, dp(50), 1f))
        customRow.addView(Button(this).apply {
            text = "检查并添加"
            setOnClickListener { validateAndAddCustom(urlInput?.text?.toString().orEmpty()) }
        })
        content.addView(customRow)

        content.addView(button("验证并打开所选来源") { openSelectedSource() })
        content.addView(button("立即检查并缓存静态资源（后台）") { warmSelectedSource() })
        content.addView(button("清除此来源的网页缓存") { clearSelectedCache() })
        content.addView(text("完整资源包约 62 MB（以所选来源提供的清单为准）。普通浏览时已访问的资源会自动持久缓存。页面存档与 Chrome 浏览器各自独立，可用存档导入／导出迁移。", 12, Color.rgb(145, 182, 173)))

        setContentView(scroll)
        refreshCacheStatus()
    }

    private fun validateAndAddCustom(raw: String) {
        val candidate = try {
            SourceRegistry.custom(raw)
        } catch (error: Exception) {
            showStatus(error.message ?: "来源网址无效。", error = true)
            return
        }
        if (candidate.builtIn) {
            sourcePrefs.setSelected(candidate.id)
            showSourceChooser("这是内置来源，已在上方选中。")
            return
        }
        setBusy("正在读取首页并检查标记……")
        background.execute {
            try {
                val home = SourceProbe.verify(candidate)
                assetCache.rememberHome(candidate, home)
                runOnUiThread {
                    sourcePrefs.addCustom(candidate)
                    sourcePrefs.setSelected(candidate.id)
                    showSourceChooser("首页标记有效，已添加 ${candidate.baseUrl}")
                }
            } catch (error: Exception) {
                runOnUiThread { showStatus(error.message ?: "无法验证这个来源。", error = true) }
            }
        }
    }

    private fun openSelectedSource(savedSource: WebSource? = null) {
        val selected = savedSource ?: selectedSource()
        if (selected == null) {
            showSourceChooser("首次启动请选择一个网页来源。")
            return
        }
        assetSyncGeneration.incrementAndGet()
        sourcePrefs.setSelected(selected.id)
        setBusy("正在验证首页……")
        background.execute {
            try {
                val (verified, onlineAvailable) = try {
                    val home = SourceProbe.verify(selected)
                    assetCache.rememberHome(selected, home)
                    assetCache.useOnlineMode()
                    home to true
                } catch (error: SourceProbe.InvalidSourceException) {
                    throw error
                } catch (error: SSLException) {
                    throw IOException("HTTPS 证书无效，已拒绝加载此来源。", error)
                } catch (networkError: Exception) {
                    val cached = assetCache.cached(selected, selected.baseUrl)
                        ?: throw IOException("无法连接来源，且没有可用的首页缓存。", networkError)
                    val html = cached.file.readBytes()
                    if (!SourceRegistry.hasHomeMarker(selected, html.toString(Charsets.UTF_8))) {
                        throw IOException("缓存首页标记无效，已拒绝离线加载。")
                    }
                    assetCache.useOfflineMode()
                    VerifiedHome(selected.baseUrl, html, cached.mimeType, cached.charset, cached.etag, cached.lastModified) to false
                }
                runOnUiThread { openVerifiedSource(selected, verified, onlineAvailable) }
            } catch (error: Exception) {
                runOnUiThread {
                    val message = error.message ?: "无法打开这个来源。"
                    if (sourceStatus == null) showSourceChooser(message) else showStatus(message, error = true)
                }
            }
        }
    }

    private fun openVerifiedSource(selected: WebSource, verified: VerifiedHome, onlineAvailable: Boolean) {
        source = selected
        sourcePrefs.setSelected(selected.id)
        if (onlineAvailable) assetCache.useOnlineMode() else assetCache.useOfflineMode()
        destroyWebView()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showSourceChooser("Android System WebView 版本过旧，请更新后再打开（需要 WebView 82 或更新版本）。")
            return
        }

        val view = WebView(this)
        webView = view
        view.setBackgroundColor(Color.rgb(8, 21, 25))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
        }
        val baseUri = Uri.parse(selected.baseUrl)
        val originRule = "${baseUri.scheme}://${baseUri.host}" + if (baseUri.port == -1 || baseUri.port == 443) "" else ":${baseUri.port}"
        run {
            val listener = WebViewCompat.WebMessageListener { messageView, message, sourceOrigin, isMainFrame, _ ->
                val currentUri = Uri.parse(messageView.url.orEmpty())
                val originMatches = sourceOrigin.scheme == "https" &&
                    sourceOrigin.host.equals(baseUri.host, true) &&
                    (sourceOrigin.port == -1 || sourceOrigin.port == baseUri.port || sourceOrigin.port == 443)
                if (isMainFrame && originMatches && SourceRegistry.allows(selected, currentUri)) {
                    val raw = message.data
                    if (!raw.isNullOrEmpty() && raw.length <= MAX_BRIDGE_MESSAGE_CHARS) {
                        runCatching {
                            val payload = JSONObject(raw)
                            when (payload.optString("type")) {
                                "play-mode" -> setPlayMode(payload.optBoolean("active"))
                                "settings-position" -> updateSettingsButtonPosition(payload)
                                "import" -> launchImportPicker()
                                "export" -> launchExportPicker(payload.optString("fileName"), payload.optString("json"))
                            }
                        }
                    }
                }
            }
            WebViewCompat.addWebMessageListener(view, "GarrisonAndroid", setOf(originRule), listener)
        }
        view.webChromeClient = WebChromeClient()
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (SourceRegistry.allows(selected, uri)) return false
                if (request.isForMainFrame && uri.scheme in listOf("https", "http", "mailto", "tel")) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                } else {
                    Toast.makeText(this@MainActivity, "已阻止加载非当前来源内容。", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val response = assetCache.intercept(request, selected)
                return if (request.url.path.orEmpty().endsWith(".css", true)) {
                    forceLandscapeStyles(response)
                } else response
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (SourceRegistry.allows(selected, Uri.parse(url))) forceMobileLandscapeUi(view)
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                handler.cancel()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    runOnUiThread { Toast.makeText(this@MainActivity, "网页加载失败；未访问过的资源需要联网后再试。", Toast.LENGTH_LONG).show() }
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                runOnUiThread {
                    setPlayMode(false)
                    showSourceChooser("网页渲染进程已结束。来源与本地缓存仍保留，可重新打开。")
                }
                return true
            }
        }
        settingsOpen = false
        val container = FrameLayout(this)
        webContainer = container
        container.addView(view, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        ))
        sourceButton = TextView(this).apply {
            text = "⚙"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(192, 245, 221))
            contentDescription = "网页来源设置"
            isClickable = true
            isFocusable = true
            alpha = 0.88f
            background = GradientDrawable().apply {
                setColor(Color.argb(226, 10, 28, 31))
                cornerRadius = dp(22).toFloat()
                setStroke(dp(1), Color.rgb(79, 145, 123))
            }
            elevation = dp(6).toFloat()
            setOnClickListener { openWebSettings() }
        }
        container.addView(sourceButton, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(8)
            marginEnd = dp(8)
        })
        setContentView(container)
        view.loadUrl(verified.url)
        if (onlineAvailable) startAssetSync(selected, verified, automatic = true)
    }

    private fun forceMobileLandscapeUi(view: WebView) {
        view.evaluateJavascript(
            """(() => {
                const root = document.documentElement;
                if (!root) return;
                const force = () => {
                    if (!root.classList.contains('native-landscape-ui')) root.classList.add('native-landscape-ui');
                };
                force();
                if (!window.__garrisonLandscapeUiObserver && window.MutationObserver) {
                    const observer = new MutationObserver(force);
                    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
                    window.__garrisonLandscapeUiObserver = observer;
                }
                window.addEventListener('resize', force, { passive: true });
                const locateSettingsButton = () => {
                    force();
                    const mobileInfo = document.querySelector('.native-top .native-mobile-info');
                    const gameExport = document.querySelector('.native-top [data-act="export"]');
                    const lobbyOnline = document.querySelector('.native-lobby-meta .native-live-dot');
                    const briefingBack = document.querySelector('.briefing-topbar .briefing-back');
                    const anchor = mobileInfo || gameExport || lobbyOnline || briefingBack;
                    if (!anchor || !window.GarrisonAndroid?.postMessage) return;
                    const rect = anchor.getBoundingClientRect();
                    const afterAnchor = anchor === mobileInfo || anchor === briefingBack;
                    const left = Math.max(4, afterAnchor ? rect.right + 8 : rect.left - 52);
                    const top = Math.max(4, rect.top + (rect.height - 44) / 2);
                    const position = `${'$'}{left.toFixed(1)},${'$'}{top.toFixed(1)}`;
                    if (position === window.__garrisonSettingsButtonPosition) return;
                    window.__garrisonSettingsButtonPosition = position;
                    window.GarrisonAndroid.postMessage(JSON.stringify({ type: 'settings-position', left, top }));
                };
                let queued = false;
                const scheduleLocate = () => {
                    if (queued) return;
                    queued = true;
                    requestAnimationFrame(() => { queued = false; locateSettingsButton(); });
                };
                locateSettingsButton();
                window.addEventListener('resize', scheduleLocate, { passive: true });
                const app = document.getElementById('app') || document.body;
                if (app && !window.__garrisonSettingsPositionObserver && window.MutationObserver) {
                    const observer = new MutationObserver(scheduleLocate);
                    observer.observe(app, { childList: true, subtree: true });
                    window.__garrisonSettingsPositionObserver = observer;
                }
            })()""".trimIndent(),
        ) { result ->
            runCatching { JSONObject(result ?: "{}") }
                .getOrNull()
                ?.let(::updateSettingsButtonPosition)
        }
    }

    private fun updateSettingsButtonPosition(payload: JSONObject) {
        val left = payload.optDouble("left", Double.NaN)
        val top = payload.optDouble("top", Double.NaN)
        if (!left.isFinite() || !top.isFinite() || left < 0 || top < 0 || left > 10_000 || top > 10_000) return
        val container = webContainer ?: return
        val button = sourceButton ?: return
        val params = button.layoutParams as? FrameLayout.LayoutParams ?: return
        params.gravity = Gravity.TOP or Gravity.START
        params.leftMargin = (left * resources.displayMetrics.density).toInt()
            .coerceIn(0, (container.width - dp(44)).coerceAtLeast(0))
        params.topMargin = (top * resources.displayMetrics.density).toInt()
            .coerceIn(0, (container.height - dp(44)).coerceAtLeast(0))
        button.layoutParams = params
    }

    private fun forceLandscapeStyles(response: WebResourceResponse): WebResourceResponse {
        if (!response.mimeType.equals("text/css", ignoreCase = true)) return response
        val css = response.data.bufferedReader(Charsets.UTF_8).use { it.readText() }
        val adapted = flattenLandscapeUiNesting(css)
        return WebResourceResponse(
            "text/css",
            "UTF-8",
            200,
            "OK",
            mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
            adapted.byteInputStream(Charsets.UTF_8),
        )
    }

    /** Android System WebView 110 in the current MuMu build predates CSS nesting (Chrome 112). */
    private fun flattenLandscapeUiNesting(css: String): String {
        val outer = Regex("html\\.native-landscape-ui\\s*\\{").find(css) ?: return css
        val outerOpen = outer.range.last
        val outerClose = matchingCssBrace(css, outerOpen) ?: return css
        val nested = css.substring(outerOpen + 1, outerClose)
        val flattened = StringBuilder(nested.length + 1024)
        var cursor = 0
        while (cursor < nested.length) {
            while (cursor < nested.length && nested[cursor].isWhitespace()) cursor++
            if (cursor >= nested.length) break
            if (nested.startsWith("/*", cursor)) {
                val commentEnd = nested.indexOf("*/", cursor + 2)
                if (commentEnd < 0) return css
                flattened.append(nested, cursor, commentEnd + 2)
                cursor = commentEnd + 2
                continue
            }
            val ruleOpen = nextCssBrace(nested, cursor) ?: return css
            val selector = nested.substring(cursor, ruleOpen).trim()
            val ruleClose = matchingCssBrace(nested, ruleOpen) ?: return css
            if (selector.isEmpty()) return css
            val fullSelector = splitCssSelectorList(selector).joinToString(", ") { part ->
                when {
                    part.startsWith("html.native-landscape-ui") -> part
                    part.startsWith("&") -> "html.native-landscape-ui${part.drop(1)}"
                    else -> "html.native-landscape-ui $part"
                }
            }
            flattened.append(fullSelector).append('{')
                .append(nested, ruleOpen + 1, ruleClose)
                .append("}\n")
            cursor = ruleClose + 1
        }
        return css.substring(0, outer.range.first) + flattened + css.substring(outerClose + 1)
    }

    private fun matchingCssBrace(css: String, open: Int): Int? {
        var depth = 0
        var quote: Char? = null
        var escaped = false
        var comment = false
        for (index in open until css.length) {
            val char = css[index]
            val next = css.getOrNull(index + 1)
            if (comment) {
                if (char == '*' && next == '/') comment = false
                continue
            }
            if (quote != null) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == quote) quote = null
                continue
            }
            if (char == '/' && next == '*') {
                comment = true
                continue
            }
            if (char == '\'' || char == '"') {
                quote = char
                continue
            }
            if (char == '{') depth++
            else if (char == '}' && --depth == 0) return index
        }
        return null
    }

    private fun nextCssBrace(css: String, start: Int): Int? {
        var quote: Char? = null
        var escaped = false
        var comment = false
        for (index in start until css.length) {
            val char = css[index]
            val next = css.getOrNull(index + 1)
            if (comment) {
                if (char == '*' && next == '/') comment = false
                continue
            }
            if (quote != null) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == quote) quote = null
                continue
            }
            if (char == '/' && next == '*') {
                comment = true
                continue
            }
            if (char == '\'' || char == '"') quote = char
            else if (char == '{') return index
        }
        return null
    }

    private fun splitCssSelectorList(selector: String): List<String> {
        val parts = mutableListOf<String>()
        var start = 0
        var parens = 0
        var brackets = 0
        var quote: Char? = null
        var escaped = false
        selector.forEachIndexed { index, char ->
            if (quote != null) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == quote) quote = null
                return@forEachIndexed
            }
            if (char == '\'' || char == '"') quote = char
            else if (char == '(') parens++
            else if (char == ')') parens--
            else if (char == '[') brackets++
            else if (char == ']') brackets--
            else if (char == ',' && parens == 0 && brackets == 0) {
                parts += selector.substring(start, index).trim()
                start = index + 1
            }
        }
        parts += selector.substring(start).trim()
        return parts.filter(String::isNotEmpty)
    }

    private fun warmSelectedSource() {
        val selected = selectedSource() ?: return
        startAssetSync(selected, automatic = false)
    }

    private fun startAssetSync(selected: WebSource, verifiedHome: VerifiedHome? = null, automatic: Boolean) {
        val generation = assetSyncGeneration.incrementAndGet()
        val isActiveSource = source?.id == selected.id
        if (isActiveSource) assetCache.useOnlineMode()
        updateAssetSyncStatus(
            selected,
            if (automatic) "网页已打开，正在后台检查静态资源……" else "正在后台检查并缓存静态资源……",
        )
        assetSync.execute {
            try {
                if (!isAssetSyncCurrent(generation)) return@execute
                val verified = verifiedHome ?: SourceProbe.verify(selected)
                assetCache.rememberHome(selected, verified)
                val manifestUrl = selected.baseUrl + "android-assets.json"
                val manifest = readSmallText(selected, manifestUrl)
                val json = parseAssetManifest(manifest)
                if (json.optInt("schemaVersion") != 1 || json.optString("appId") != SourceRegistry.APP_ID) {
                    throw IOException("资源清单不属于卫戍协议 App。")
                }
                val files = json.optJSONArray("files") ?: throw IOException("资源清单缺少文件列表。")
                if (files.length() > 3000) throw IOException("资源文件数量超出限制。")
                val totalBytes = json.optLong("totalBytes", -1)
                if (totalBytes !in 0L..(768L * 1024 * 1024)) throw IOException("资源包总大小超出限制。")
                val entries = buildList {
                    for (index in 0 until files.length()) {
                        val item = files.getJSONObject(index)
                        val path = item.getString("path")
                        val size = item.getLong("size")
                        val hash = item.getString("sha256")
                        if (path.startsWith('/') || path.split('/').any { it == ".." || it == "." }) throw IOException("资源清单包含非法路径。")
                        if (size !in 0L..(80L * 1024 * 1024) || !hash.matches(Regex("[a-fA-F0-9]{64}"))) throw IOException("资源清单包含无效校验值。")
                        add(AssetItem(selected.baseUrl + path, size, hash.lowercase(), item.optString("mime", "application/octet-stream")))
                    }
                }
                if (entries.sumOf { it.size } != totalBytes) throw IOException("资源总大小与清单内容不一致。")

                val manifestHash = sha256(entries.sortedBy { it.url }.joinToString("\n") {
                    "${it.url}\u0000${it.size}\u0000${it.sha256}\u0000${it.mime}"
                })
                val previousManifestHash = sourcePrefs.cachedManifestHash(selected.id)
                val completeBeforeSync = entries.all { entry ->
                    val cached = assetCache.cached(selected, entry.url)
                    cached != null && cached.sha256.equals(entry.sha256, true) && cached.file.length() == entry.size
                }
                if (completeBeforeSync) {
                    if (!isAssetSyncCurrent(generation)) return@execute
                    sourcePrefs.setCachedManifestHash(selected.id, manifestHash)
                    if (source?.id == selected.id) assetCache.useOfflineMode()
                    val status = if (previousManifestHash == manifestHash) {
                        "静态资源没有变化，已切换到本地缓存。"
                    } else {
                        "静态资源与当前版本一致，已切换到本地缓存。"
                    }
                    updateAssetSyncStatus(selected, status)
                    return@execute
                }

                val updateNotice = if (previousManifestHash != null && previousManifestHash != manifestHash) {
                    "检测到静态资源更新，正在后台缓存；游戏可继续运行。"
                } else {
                    "正在后台补齐静态资源缓存；游戏可继续运行。"
                }
                updateAssetSyncStatus(selected, "$updateNotice（${entries.size} 项，${formatBytes(totalBytes)}）")
                var completed = 0
                var cachedBytes = 0L
                var failures = 0
                for (entry in entries) {
                    if (!isAssetSyncCurrent(generation)) return@execute
                    try {
                        val cached = assetCache.cached(selected, entry.url)
                        if (cached == null || !cached.sha256.equals(entry.sha256, true) || cached.file.length() != entry.size) {
                            val fetched = SourceProbe.fetchAsset(selected, entry.url, entry.size)
                            if (sha256(fetched) != entry.sha256) throw IOException("校验失败：${entry.url.substringAfter(selected.baseUrl)}")
                            assetCache.rememberAsset(selected, entry.url, fetched, entry.mime)
                        }
                        cachedBytes += entry.size
                    } catch (_: Exception) {
                        failures++
                    }
                    completed++
                    if (completed % 10 == 0 || completed == entries.size) {
                        updateAssetSyncStatus(
                            selected,
                            "后台缓存 $completed/${entries.size} · ${formatBytes(cachedBytes)} · 失败 $failures",
                        )
                    }
                }

                if (!isAssetSyncCurrent(generation)) return@execute
                val completeAfterSync = failures == 0 && entries.all { entry ->
                    val cached = assetCache.cached(selected, entry.url)
                    cached != null && cached.sha256.equals(entry.sha256, true) && cached.file.length() == entry.size
                }
                if (completeAfterSync) {
                    sourcePrefs.setCachedManifestHash(selected.id, manifestHash)
                    if (source?.id == selected.id) assetCache.useOfflineMode()
                    updateAssetSyncStatus(selected, "静态资源缓存已更新，后续从本地加载。")
                } else {
                    val reason = if (failures > 0) "有 $failures 项下载失败" else "缓存校验未通过"
                    updateAssetSyncStatus(selected, "后台缓存未完成（$reason），网页继续在线加载。", error = true)
                }
            } catch (error: Exception) {
                if (isAssetSyncCurrent(generation)) {
                    updateAssetSyncStatus(selected, error.message ?: "无法检查网页资源清单，网页继续在线加载。", error = true)
                }
            }
        }
    }

    private fun isAssetSyncCurrent(generation: Long): Boolean =
        generation == assetSyncGeneration.get() && !isFinishing && !isDestroyed

    private fun updateAssetSyncStatus(selected: WebSource, message: String, error: Boolean = false) {
        sourcePrefs.setCacheStatus(selected.id, message)
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            val visibleSource = selectedSource()
            if (visibleSource?.id == selected.id && sourceStatus != null) {
                showStatus(message, error)
            }
        }
    }

    private fun readSmallText(selected: WebSource, address: String): String {
        if (!SourceRegistry.allows(selected, Uri.parse(address))) throw IOException("资源清单超出来源范围。")
        val connection = URL(address).openConnection() as java.net.HttpURLConnection
        connection.connectTimeout = 12_000
        connection.readTimeout = 18_000
        connection.setRequestProperty("Accept-Encoding", "identity")
        try {
            if (connection.responseCode != 200) {
                throw IOException(missingAssetManifestMessage())
            }
            if (connection.contentLengthLong > 2L * 1024 * 1024) throw IOException("资源清单过大。")
            return connection.inputStream.use { stream ->
                readBounded(stream, 2 * 1024 * 1024, "资源清单过大。").toString(Charsets.UTF_8)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun parseAssetManifest(body: String): JSONObject {
        val jsonText = body.trimStart('\uFEFF', ' ', '\t', '\r', '\n')
        if (!jsonText.startsWith('{')) {
            val detail = if (jsonText.startsWith('<')) {
                "网页源将 android-assets.json 回退成了 HTML 页面。"
            } else {
                "网页源的 android-assets.json 不是 JSON 清单。"
            }
            throw IOException("$detail ${missingAssetManifestMessage()}")
        }
        return runCatching { JSONObject(jsonText) }
            .getOrElse { throw IOException("网页源的 android-assets.json 格式无效，请重新部署资源清单。", it) }
    }

    private fun missingAssetManifestMessage(): String =
        "请在网页源的构建流程运行 npm run build 并重新部署。普通浏览时已访问的资源仍会自动缓存。"

    private data class AssetItem(val url: String, val size: Long, val sha256: String, val mime: String)

    private fun selectedSource(): WebSource? {
        val group = sourceGroup ?: return sourcePrefs.selectedSource()
        val checked = group.findViewById<RadioButton>(group.checkedRadioButtonId)
        val id = checked?.tag as? String ?: return null
        return sourcePrefs.sources().firstOrNull { it.id == id }
    }

    private fun clearSelectedCache() {
        val selected = selectedSource() ?: return
        assetSyncGeneration.incrementAndGet()
        assetCache.clear(selected)
        sourcePrefs.clearCacheMetadata(selected.id)
        if (source?.id == selected.id) assetCache.useOnlineMode()
        refreshCacheStatus("已清除此来源的网页资源缓存。")
    }

    private fun refreshCacheStatus(message: String? = null) {
        val selected = selectedSource() ?: return
        val (count, bytes) = assetCache.cacheStats(selected)
        val status = sourcePrefs.cacheStatus(selected.id)
        val suffix = listOfNotNull(status, "当前来源已缓存 $count 项 / ${formatBytes(bytes)}。")
            .joinToString(" ")
        sourceStatus?.text = listOfNotNull(message, suffix).joinToString(" ")
        sourceStatus?.setTextColor(Color.rgb(121, 220, 183))
    }

    private fun setBusy(message: String) {
        runOnUiThread {
            sourceStatus?.text = message
            sourceStatus?.setTextColor(Color.rgb(240, 209, 138))
        }
    }

    private fun showStatus(message: String, error: Boolean = false) {
        sourceStatus?.text = message
        sourceStatus?.setTextColor(if (error) Color.rgb(255, 150, 130) else Color.rgb(121, 220, 183))
    }

    private fun destroyWebView() {
        webView?.let { view ->
            view.stopLoading()
            view.webChromeClient = null
            view.webViewClient = WebViewClient()
            view.removeAllViews()
            view.destroy()
        }
        webView = null
        sourceButton = null
        webContainer = null
        setPlayMode(false)
    }

    @SuppressLint("SourceLockedOrientationActivity")
    private fun setPlayMode(active: Boolean) {
        playMode = active
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        applySystemBars()
    }

    private fun applySystemBars() {
        if (playMode) hideSystemBars() else hideStatusBarAndShowNavigation()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        val decor = window.decorView
        if (!decor.isAttachedToWindow) {
            decor.post { if (decor.isAttachedToWindow) hideSystemBars() }
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Api30SystemBars.hide(window)
        } else {
            decor.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
    }

    @Suppress("DEPRECATION")
    private fun hideStatusBarAndShowNavigation() {
        val decor = window.decorView
        if (!decor.isAttachedToWindow) {
            decor.post { if (decor.isAttachedToWindow) hideStatusBarAndShowNavigation() }
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Api30SystemBars.hideStatusBarAndShowNavigation(window)
        } else {
            decor.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    private fun launchImportPicker() {
        if (!isVerifiedPage()) return
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
        }
        try {
            startActivityForResult(intent, REQUEST_IMPORT)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "设备上没有可用的文件选择器。", Toast.LENGTH_LONG).show()
        }
    }

    private fun launchExportPicker(fileName: String, json: String) {
        if (!isVerifiedPage()) return
        if (json.toByteArray(Charsets.UTF_8).size > MAX_SAVE_BYTES) {
            Toast.makeText(this, "存档超过 10 MB，未导出。", Toast.LENGTH_LONG).show()
            return
        }
        pendingExport = json.toByteArray(Charsets.UTF_8)
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100).ifBlank { "garrison-save.json" }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, if (safeName.endsWith(".json", true)) safeName else "$safeName.json")
        }
        try {
            startActivityForResult(intent, REQUEST_EXPORT)
        } catch (_: ActivityNotFoundException) {
            pendingExport = null
            Toast.makeText(this, "设备上没有可用的文件选择器。", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Use Activity Result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data?.data == null) {
            if (requestCode == REQUEST_EXPORT) pendingExport = null
            return
        }
        val uri = data.data ?: return
        when (requestCode) {
            REQUEST_IMPORT -> background.execute {
                try {
                    val bytes = contentResolver.openInputStream(uri)?.use { input -> readBounded(input, MAX_SAVE_BYTES) }
                        ?: throw IOException("无法读取所选存档。")
                    if (bytes.size > MAX_SAVE_BYTES) throw IOException("存档超过 10 MB。")
                    val jsonText = bytes.toString(Charsets.UTF_8)
                    runOnUiThread {
                        val quoted = JSONObject.quote(jsonText)
                        webView?.evaluateJavascript("window.__garrisonImportCallback && window.__garrisonImportCallback($quoted)", null)
                    }
                } catch (error: Exception) {
                    runOnUiThread { Toast.makeText(this, error.message ?: "存档读取失败。", Toast.LENGTH_LONG).show() }
                }
            }
            REQUEST_EXPORT -> background.execute {
                try {
                    val bytes = pendingExport ?: throw IOException("没有可写入的存档内容。")
                    contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                        ?: throw IOException("无法写入所选位置。")
                    runOnUiThread { Toast.makeText(this, "存档已导出。", Toast.LENGTH_SHORT).show() }
                } catch (error: Exception) {
                    runOnUiThread { Toast.makeText(this, error.message ?: "存档导出失败。", Toast.LENGTH_LONG).show() }
                } finally {
                    pendingExport = null
                }
            }
        }
    }

    private fun isVerifiedPage(): Boolean {
        val current = source ?: return false
        val currentUrl = webView?.url ?: return false
        return SourceRegistry.allows(current, Uri.parse(currentUrl))
    }

    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        setTextColor(Color.rgb(8, 37, 30))
        setBackgroundColor(Color.rgb(121, 220, 183))
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)).apply {
            topMargin = dp(8)
            bottomMargin = dp(4)
        }
    }

    private fun text(value: String, size: Int, color: Int, bold: Boolean = false): TextView = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(5), 0, dp(5))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024 -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
        bytes >= 1024 -> "%.0f KB".format(bytes / 1024.0)
        else -> "$bytes B"
    }

    private fun readBounded(input: java.io.InputStream, limit: Int, limitMessage: String = "存档超过 10 MB。"): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > limit) throw IOException(limitMessage)
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.R)
    private object Api30SystemBars {
        fun hide(window: android.view.Window) {
            window.insetsController?.let { controller ->
                controller.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
            }
        }

        fun hideStatusBarAndShowNavigation(window: android.view.Window) {
            window.insetsController?.let { controller ->
                controller.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_DEFAULT
                controller.hide(android.view.WindowInsets.Type.statusBars())
                controller.show(android.view.WindowInsets.Type.navigationBars())
            }
        }
    }

    companion object {
        private const val REQUEST_IMPORT = 21
        private const val REQUEST_EXPORT = 22
        private const val MAX_SAVE_BYTES = 10 * 1024 * 1024
        private const val MAX_BRIDGE_MESSAGE_CHARS = 24 * 1024 * 1024
    }
}
