package com.example.pressdock

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SecretArgs { lateinit var secret: String }
@InvokeArg
class WriteArgs { lateinit var uri: String; lateinit var data: String }

// 仅由 Rust 插件句柄调用；不向业务 WebView 授予此插件的前端命令权限。
@TauriPlugin
class PlatformPlugin(private val activity: Activity) : Plugin(activity) {
    private external fun initializeTls(context: android.content.Context)
    init { initializeTls(activity.applicationContext) }
    override fun load(webView: WebView) {
        val owner = activity as AppCompatActivity
        owner.onBackPressedDispatcher.addCallback(owner, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("""(() => {
                    const event = new Event('pressdock-back', { cancelable: true });
                    return !window.dispatchEvent(event);
                })()""") { handled ->
                    if (handled != "true") activity.moveTaskToBack(true)
                }
            }
        })
    }
    private val alias = "pressdock.cms.session.v1"
    private val secretFile get() = File(activity.noBackupFilesDir, "cms-session.enc")
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Command
    fun saveSecret(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretArgs::class.java)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encoded = cipher.iv + cipher.doFinal(args.secret.toByteArray(Charsets.UTF_8))
            val temporary = File(activity.noBackupFilesDir, "cms-session.tmp")
            temporary.outputStream().use { it.write(encoded); it.fd.sync() }
            if (!temporary.renameTo(secretFile)) throw java.io.IOException()
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("安全存储失败") }
    }
    @Command
    fun loadSecret(invoke: Invoke) {
        try {
            val result = JSObject()
            if (secretFile.exists()) {
                val bytes = secretFile.readBytes()
                require(bytes.size > 28)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
                result.put("value", String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
            } else result.put("value", org.json.JSONObject.NULL)
            invoke.resolve(result)
        } catch (_: Exception) { invoke.reject("安全存储读取失败") }
    }
    @Command
    fun deleteSecret(invoke: Invoke) {
        try {
            if (secretFile.exists() && !secretFile.delete()) throw java.io.IOException()
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("安全存储清理失败") }
    }
    @Command
    fun writeDocument(invoke: Invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        val uri = Uri.parse(args.uri)
        try {
            require(uri.scheme == "content")
            val bytes = Base64.decode(args.data, Base64.NO_WRAP)
            require(bytes.isNotEmpty() && bytes.size <= 20 * 1024 * 1024)
            activity.contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes); it.flush() } ?: throw java.io.IOException()
            var name = "图片"
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
            }
            val result = JSObject(); result.put("fileName", name); invoke.resolve(result)
        } catch (_: Exception) {
            try { android.provider.DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) { }
            invoke.reject("图片保存失败")
        }
    }
}
