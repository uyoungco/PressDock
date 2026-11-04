package com.example.pressdock

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.webkit.WebViewCompat
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONTokener
import java.util.UUID

// 独立 Android WebView：不创建 RustWebView、不安装 JS interface、不加载业务应用。
internal class HarvestWebView(private val activity: Activity) {
    private var source: WebView? = null
    private var host: FrameLayout? = null
    private var dialog: Dialog? = null
    private var session: String? = null

    private fun foreground() = !activity.isFinishing && !activity.isDestroyed &&
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    private fun current(id: String): WebView {
        check(foreground() && session == id)
        return checkNotNull(source)
    }

    private fun perform(invoke: Invoke, work: () -> Unit) {
        activity.runOnUiThread {
            try { work() } catch (_: Exception) { invoke.reject("来源网页不可用，请返回前台后重试") }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun open(invoke: Invoke) = perform(invoke) {
        check(!BuildConfig.PRESSDOCK_DEMO && foreground())
        if (source == null) {
            val view = WebView(activity)
            // 必须在首次 loadUrl 前设置；不通过页面 JS 伪造 navigator。
            val agent = HarvestPolicy.desktopUserAgent(
                WebSettings.getDefaultUserAgent(activity),
                WebViewCompat.getCurrentWebViewPackage(activity)?.versionName,
            )
            view.settings.apply {
                userAgentString = agent
                useWideViewPort = true
                loadWithOverviewMode = true
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(true)
                builtInZoomControls = true
                displayZoomControls = false
            }
            view.webViewClient = object : WebViewClient() {
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    close()
                    return true
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                    !HarvestPolicy.navigationAllowed(request.url.toString())
                @Deprecated("Required for older WebView callbacks")
                override fun shouldOverrideUrlLoading(view: WebView, url: String) =
                    !HarvestPolicy.navigationAllowed(url)
            }
            // 默认拒绝新窗口、文件选择和权限申请；无下载处理器。
            view.webChromeClient = WebChromeClient()
            view.setDownloadListener { _, _, _, _, _ -> }
            view.setOnLongClickListener { true }
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            val background = FrameLayout(activity).apply {
                alpha = 0f
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                addView(view, FrameLayout.LayoutParams(-1, -1))
            }
            // 保持附着与完整布局尺寸，业务 WebView 在其上方；不暂停全进程计时器。
            content.addView(background, 0, ViewGroup.LayoutParams(-1, -1))
            source = view
            host = background
            session = UUID.randomUUID().toString()
            view.loadUrl("about:blank")
        }
        invoke.resolve(JSObject().apply { put("id", session) })
    }

    fun navigate(invoke: Invoke, id: String, url: String, token: String) = perform(invoke) {
        require(HarvestPolicy.navigationAllowed(url) && url != "about:blank")
        val view = current(id)
        // 文档 token 标记与导航顺序执行，禁止把旧页当作新页读取。
        view.evaluateJavascript("window.__pressdockHarvestPreviousDocument=${org.json.JSONObject.quote(token)};null") {
            if (session == id && foreground()) {
                view.loadUrl(url)
                invoke.resolve(JSObject())
            } else invoke.reject("来源采集已中断")
        }
    }

    fun snapshot(invoke: Invoke, id: String, script: String) = perform(invoke) {
        val view = current(id)
        view.evaluateJavascript("(() => {try {return JSON.stringify(($script));} catch (_) {return null;}})()") { value ->
            try {
                check(session == id && foreground())
                val snapshot = JSONTokener(value).nextValue() as? String ?: error("无效快照")
                require(snapshot.toByteArray(Charsets.UTF_8).size <= 10 * 1024 * 1024)
                invoke.resolve(JSObject().apply { put("snapshot", snapshot) })
            } catch (_: Exception) { invoke.reject("来源页面读取失败或内容过大") }
        }
    }

    fun show(invoke: Invoke) = perform(invoke) {
        check(foreground())
        val view = checkNotNull(source)
        if (dialog == null) {
            (view.parent as? ViewGroup)?.removeView(view)
            val panel = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
            val hint = TextView(activity).apply {
                text = "来源网页 · PC 模式\n完成验证后返回，点击“验证完成，继续”"
                setPadding(16, 8, 16, 8)
            }
            val back = Button(activity).apply { text = "返回素材导入"; minHeight = (48 * resources.displayMetrics.density).toInt() }
            panel.addView(back, LinearLayout.LayoutParams(-1, -2))
            panel.addView(hint, LinearLayout.LayoutParams(-1, -2))
            panel.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
            val overlay = Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar).apply {
                setContentView(panel)
                setOnDismissListener {
                    (view.parent as? ViewGroup)?.removeView(view)
                    host?.addView(view, FrameLayout.LayoutParams(-1, -1))
                    dialog = null
                }
            }
            back.setOnClickListener { overlay.dismiss() }
            dialog = overlay
            overlay.show()
            overlay.window?.apply {
                setLayout(-1, -1)
                clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                WindowCompat.setDecorFitsSystemWindows(this, false)
            }
            ViewCompat.setOnApplyWindowInsetsListener(panel) { root, insets ->
                val padding = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
                root.setPadding(padding.left, padding.top, padding.right, padding.bottom)
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(panel)
        }
        invoke.resolve(JSObject())
    }

    fun hide(invoke: Invoke) = perform(invoke) {
        dialog?.dismiss()
        invoke.resolve(JSObject())
    }

    fun close() {
        activity.runOnUiThread {
            session = null
            dialog?.dismiss()
            dialog = null
            source?.apply {
                stopLoading()
                (parent as? ViewGroup)?.removeView(this)
                destroy()
            }
            source = null
            host?.let { (it.parent as? ViewGroup)?.removeView(it) }
            host = null
        }
    }
}
