package com.example.pressdock

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val provider = WebViewCompat.getCurrentWebViewPackage(this)
    val version = provider?.versionName ?: "未识别"
    val major = version.substringBefore('.').toIntOrNull()
      ?: Regex("Chrome/(\\d+)").find(webView.settings.userAgentString)
        ?.groupValues?.get(1)?.toIntOrNull()
    if (major != null && major >= 111) return

    // 在业务脚本加载前阻止执行；更新提示不能依赖无法运行的前端。
    webView.settings.javaScriptEnabled = false
    webView.visibility = View.INVISIBLE
    webView.post {
      if (!isFinishing && !isDestroyed) {
        AlertDialog.Builder(this)
          .setTitle("需要更新系统网页组件")
          .setMessage("当前 WebView 版本：$version。\n\nPressDock 需要 111 或更高版本。请在可信应用商店更新 Android System WebView，更新后重新打开应用。")
          .setCancelable(false)
          .setPositiveButton("打开应用商店") { _, _ ->
            openWebViewStore(provider?.packageName ?: "com.google.android.webview")
            finish()
          }
          .setNegativeButton("退出") { _, _ -> finish() }
          .show()
      }
    }
  }

  private fun openWebViewStore(packageName: String) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")))
    } catch (_: ActivityNotFoundException) {
      try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
      } catch (_: ActivityNotFoundException) {
        Toast.makeText(this, "未找到应用商店或浏览器，请更新系统网页组件后再打开 PressDock。", Toast.LENGTH_LONG).show()
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val padding = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
