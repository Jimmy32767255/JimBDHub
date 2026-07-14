package org.jimmy.bdhub

import android.annotation.SuppressLint
import android.content.Intent
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
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.documentfile.provider.DocumentFile
import androidx.webkit.WebViewAssetLoader
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val PREFS_NAME = "JimBDHubPrefs"
    private val PREF_SYNC_FOLDER = "sync_folder_uri"
    private val SYNC_FILE_NAME = "JimBDHub.sync.json"
    private val SYNC_POLL_INTERVAL_SECONDS = 3L

    private var syncFolderUri: Uri? = null
    private var syncFile: DocumentFile? = null
    private var syncLastModified: Long = 0L
    private var pendingEnableSync = false
    private val syncExecutor = Executors.newSingleThreadScheduledExecutor()
    private var syncFuture: ScheduledFuture<*>? = null

    private var pageLoaded = false
    private var widgetRecordsReady = false

    companion object {
        const val EXTRA_FROM_WIDGET = "from_widget"
    }

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

    private val openDocumentTreeLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri == null) {
            if (pendingEnableSync) {
                pendingEnableSync = false
                notifySyncCallback("""{"ok":false,"error":${escapeJson("已取消选择文件夹")}}""")
            }
            return@registerForActivityResult
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit {
                    putString(PREF_SYNC_FOLDER, uri.toString())
                }
            syncFolderUri = uri
            if (pendingEnableSync) {
                pendingEnableSync = false
                enableSyncInternal()
            }
        } catch (e: Exception) {
            if (pendingEnableSync) {
                pendingEnableSync = false
                val errorJson = escapeJson(e.message ?: "获取文件夹权限失败")
                notifySyncCallback("""{"ok":false,"error":${errorJson}}""")
            }
        }
    }

    private var pendingBackupJson: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        configureWebView(webView)

        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        if (intent?.getBooleanExtra(EXTRA_FROM_WIDGET, false) == true) {
            widgetRecordsReady = true
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_FROM_WIDGET, false)) {
            widgetRecordsReady = true
            if (pageLoaded) {
                syncWidgetRecords()
            }
        }
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

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageLoaded = true
                if (widgetRecordsReady) {
                    syncWidgetRecords()
                }
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

    private fun loadSavedSyncFolder() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val uriString = prefs.getString(PREF_SYNC_FOLDER, null) ?: return
        try {
            val uri = uriString.toUri()
            val perms = contentResolver.persistedUriPermissions
            val hasPerm = perms.any { it.uri == uri && it.isWritePermission && it.isReadPermission }
            if (hasPerm) {
                syncFolderUri = uri
            } else {
                prefs.edit { remove(PREF_SYNC_FOLDER) }
            }
        } catch (e: Exception) {
            prefs.edit { remove(PREF_SYNC_FOLDER) }
        }
    }

    private fun ensureSyncFile(): DocumentFile? {
        val folderUri = syncFolderUri ?: return null
        val folder = DocumentFile.fromTreeUri(this, folderUri) ?: return null
        if (!folder.exists() || !folder.isDirectory) return null
        val existing = folder.findFile(SYNC_FILE_NAME)
        if (existing != null && existing.isFile) {
            syncFile = existing
            return existing
        }
        return try {
            val created = folder.createFile("application/json", SYNC_FILE_NAME)
            syncFile = created
            created
        } catch (e: Exception) {
            null
        }
    }

    private fun readSyncFile(file: DocumentFile): String? {
        return try {
            contentResolver.openInputStream(file.uri)?.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).use { reader ->
                    reader.readText()
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun writeSyncFileContent(file: DocumentFile, json: String): Boolean {
        return try {
            contentResolver.openOutputStream(file.uri)?.use { output ->
                output.write(json.toByteArray(Charsets.UTF_8))
            }
            syncLastModified = file.lastModified()
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun enableSyncInternal() {
        loadSavedSyncFolder()
        if (syncFolderUri == null) {
            pendingEnableSync = true
            openDocumentTreeLauncher.launch(null)
            return
        }
        val file = ensureSyncFile()
        if (file == null) {
            notifySyncCallback("""{"ok":false,"error":${escapeJson("无法创建同步文件")}}""")
            return
        }
        syncLastModified = file.lastModified()
        val content = readSyncFile(file)
        val folderName = DocumentFile.fromTreeUri(this, syncFolderUri!!)?.name ?: ""
        val folderNameJson = escapeJson(folderName)
        val contentJson = content?.let { escapeJson(it) } ?: "null"
        notifySyncCallback("""{"ok":true,"folderName":${folderNameJson},"content":${contentJson}}""")
        startSyncPolling()
    }

    private fun startSyncPolling() {
        stopSyncPolling()
        syncFuture = syncExecutor.scheduleWithFixedDelay({
            pollSyncFile()
        }, SYNC_POLL_INTERVAL_SECONDS, SYNC_POLL_INTERVAL_SECONDS, TimeUnit.SECONDS)
    }

    private fun stopSyncPolling() {
        syncFuture?.cancel(false)
        syncFuture = null
    }

    private fun pollSyncFile() {
        try {
            val file = syncFile ?: ensureSyncFile() ?: return
            if (!file.exists()) {
                syncFile = null
                return
            }
            val lastModified = file.lastModified()
            if (lastModified > syncLastModified + 1000L) {
                syncLastModified = lastModified
                val content = readSyncFile(file) ?: return
                runOnUiThread {
                    webView.evaluateJavascript(
                        "if (window.__syncthingCallback) window.__syncthingCallback(${
                            escapeJson(
                                content
                            )
                        })",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            // ignore polling errors
        }
    }

    private fun notifySyncCallback(json: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "if (window.__androidSyncCallback) window.__androidSyncCallback(${escapeJson(json)})",
                null
            )
        }
    }

    fun enableSync() {
        runOnUiThread {
            enableSyncInternal()
        }
    }

    fun disableSync() {
        stopSyncPolling()
        syncFolderUri = null
        syncFile = null
        syncLastModified = 0L
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit {
                remove(PREF_SYNC_FOLDER)
            }
        notifySyncCallback("""{"ok":true}""")
    }

    fun writeSyncFile(json: String) {
        syncExecutor.execute {
            val file = syncFile ?: ensureSyncFile()
            if (file == null) {
                notifySyncCallback("""{"ok":false,"error":${escapeJson("无法访问同步文件")}}""")
                return@execute
            }
            val ok = writeSyncFileContent(file, json)
            if (ok) {
                notifySyncCallback("""{"ok":true}""")
            } else {
                notifySyncCallback("""{"ok":false,"error":${escapeJson("写入同步文件失败")}}""")
            }
        }
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

    override fun onResume() {
        super.onResume()
        if (syncFolderUri != null && syncFuture == null) {
            startSyncPolling()
        }
        if (pageLoaded && widgetRecordsReady) {
            syncWidgetRecords()
        }
    }

    override fun onPause() {
        super.onPause()
        stopSyncPolling()
    }

    override fun onDestroy() {
        stopSyncPolling()
        syncExecutor.shutdown()
        if (::webView.isInitialized) {
            webView.stopLoading()
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    fun syncWidgetRecords() {
        if (!::webView.isInitialized) return
        val records = SleepWidgetHelper.consumePendingRecords(this)
        if (records.isEmpty()) {
            widgetRecordsReady = false
            return
        }
        for (record in records) {
            val js = """
                (function() {
                    if (typeof window.__widgetAddSleep === 'function') {
                        window.__widgetAddSleep({
                            startTime: ${record.startMs},
                            endTime: ${record.endMs},
                            quality: 0,
                            interruptions: [],
                            note: "Widget"
                        });
                    }
                })();
            """.trimIndent()
            webView.evaluateJavascript(js, null)
        }
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

        @JavascriptInterface
        fun enableSync() {
            this@MainActivity.enableSync()
        }

        @JavascriptInterface
        fun disableSync() {
            this@MainActivity.disableSync()
        }

        @JavascriptInterface
        fun writeSyncFile(json: String) {
            this@MainActivity.writeSyncFile(json)
        }

        @JavascriptInterface
        fun onWidgetReady() {
            runOnUiThread {
                widgetRecordsReady = true
                if (pageLoaded) {
                    syncWidgetRecords()
                }
            }
        }
    }
}
