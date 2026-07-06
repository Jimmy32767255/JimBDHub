package org.jimmy.bdhub

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.BufferedReader
import java.io.InputStreamReader

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val createBackupLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) {
            Toast.makeText(this, "已取消导出", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        val json = pendingBackupJson
        if (json == null) {
            Toast.makeText(this, "导出内容为空", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        try {
            contentResolver.openOutputStream(uri)?.use { output ->
                output.write(json.toByteArray(Charsets.UTF_8))
            }
            Toast.makeText(this, "备份已保存", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "保存失败：${e.message}", Toast.LENGTH_LONG).show()
        } finally {
            pendingBackupJson = null
        }
    }

    private val openBackupLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            val json = readTextFromUri(uri)
            if (json != null) {
                webView.evaluateJavascript(
                    "if (window.__androidBackupCallback) window.__androidBackupCallback(${
                        escapeJson(
                            json
                        )
                    })",
                    null
                )
            } else {
                evaluateJavascriptError("读取文件失败")
            }
        } catch (e: Exception) {
            evaluateJavascriptError(e.message ?: "读取文件失败")
        }
    }

    private var pendingBackupJson: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        configureWebView(webView)

        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): android.webkit.WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request!!.url)
                    ?: super.shouldInterceptRequest(view, request)
            }
        }

        wv.webChromeClient = WebChromeClient()

        val settings: WebSettings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        wv.addJavascriptInterface(AndroidBridge(), "AndroidBridge")
    }

    private fun readTextFromUri(uri: Uri): String? {
        return contentResolver.openInputStream(uri)?.use { input ->
            BufferedReader(InputStreamReader(input, Charsets.UTF_8)).use { reader ->
                reader.readText()
            }
        }
    }

    private fun evaluateJavascriptError(message: String) {
        webView.evaluateJavascript(
            "if (window.__androidBackupError) window.__androidBackupError(${escapeJson(message)})",
            null
        )
    }

    private fun escapeJson(text: String): String {
        return "\"" + text
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t") + "\""
    }

    fun saveBackup(json: String, suggestedName: String) {
        pendingBackupJson = json
        createBackupLauncher.launch(suggestedName)
    }

    fun pickBackup() {
        openBackupLauncher.launch(arrayOf("application/json"))
    }

    @Deprecated("Deprecated in Java")
    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() {
        super.onBackPressed()
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            finish()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun saveBackup(json: String, suggestedName: String) {
            runOnUiThread {
                this@MainActivity.saveBackup(json, suggestedName)
            }
        }

        @JavascriptInterface
        fun pickBackup() {
            runOnUiThread {
                this@MainActivity.pickBackup()
            }
        }
    }
}
