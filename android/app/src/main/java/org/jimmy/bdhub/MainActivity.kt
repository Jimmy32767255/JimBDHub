package org.jimmy.bdhub

import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.util.Base64
import android.util.TypedValue
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val PREFS_NAME = "JimBDHubPrefs"
    private val PREF_SYNC_FOLDER = "sync_folder_uri"
    private val SYNC_FILE_NAME = "JimBDHub.sync.json"
    private val SYNC_POLL_INTERVAL_SECONDS = 3L
    // 自动备份文件名格式：JimBDHub_AutoBackup_{操作}_{yyyyMMddHHmm毫秒}.json（操作固定英文，触发原因）
    private val AUTO_BACKUP_PREFIX = "JimBDHub_AutoBackup_"

    private var syncFolderUri: Uri? = null
    private var syncFile: DocumentFile? = null
    private var syncLastModified: Long = 0L
    private var pendingEnableSync = false
    private val syncExecutor = Executors.newSingleThreadScheduledExecutor()
    private var syncFuture: ScheduledFuture<*>? = null

    private var pageLoaded = false
    private var widgetRecordsReady = false

    // Markdown 等文本导出的待写入内容
    private var pendingExportText: String? = null

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

    private val createExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/markdown")
    ) { uri ->
        if (uri == null) {
            Toast.makeText(this, "已取消导出", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        val text = pendingExportText
        if (text == null) {
            Toast.makeText(this, "导出内容为空", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        try {
            contentResolver.openOutputStream(uri)?.use { output ->
                output.write(text.toByteArray(Charsets.UTF_8))
            }
            Toast.makeText(this, "已导出", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "保存失败：${e.message}", Toast.LENGTH_LONG).show()
        } finally {
            pendingExportText = null
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

    private val openBackgroundImageLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            val dataUrl = readImageAsDataUrl(uri)
            if (dataUrl != null) {
                webView.evaluateJavascript(
                    "if (window.__androidBackgroundImageCallback) window.__androidBackgroundImageCallback(${
                        escapeJson(
                            dataUrl
                        )
                    })",
                    null
                )
            } else {
                evaluateJavascriptBackgroundImageError("读取图片失败")
            }
        } catch (e: Exception) {
            evaluateJavascriptBackgroundImageError(e.message ?: "读取图片失败")
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

    private val autoBackupFolderLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri == null) {
            notifyAutoBackupCallback("""{"ok":false,"cancelled":true}""")
            return@registerForActivityResult
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            val folderName = DocumentFile.fromTreeUri(this, uri)?.name ?: ""
            notifyAutoBackupCallback(
                JSONObject()
                    .put("ok", true)
                    .put("uri", uri.toString())
                    .put("folderName", folderName)
                    .toString()
            )
        } catch (e: Exception) {
            notifyAutoBackupCallback(
                JSONObject()
                    .put("ok", false)
                    .put("error", e.message ?: "获取文件夹权限失败")
                    .toString()
            )
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

    private fun readImageAsDataUrl(uri: Uri): String? {
        val mimeType = contentResolver.getType(uri) ?: "image/*"
        return contentResolver.openInputStream(uri)?.use { input ->
            val bytes = input.readBytes()
            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            "data:$mimeType;base64,$base64"
        }
    }

    private fun evaluateJavascriptBackgroundImageError(message: String) {
        webView.evaluateJavascript(
            "if (window.__androidBackgroundImageError) window.__androidBackgroundImageError(${escapeJson(message)})",
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

    fun saveTextFile(text: String, suggestedName: String) {
        pendingExportText = text
        createExportLauncher.launch(suggestedName)
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

    private fun notifyAutoBackupCallback(json: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "if (window.__androidAutoBackupCallback) window.__androidAutoBackupCallback(${escapeJson(json)})",
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

    private fun backupFolderFromUri(uriString: String): DocumentFile? {
        return try {
            val folder = DocumentFile.fromTreeUri(this, uriString.toUri())
            if (folder != null && folder.exists() && folder.isDirectory) folder else null
        } catch (e: Exception) {
            null
        }
    }

    private fun listAutoBackupsIn(folder: DocumentFile): JSONArray {
        val result = JSONArray()
        folder.listFiles()
            .filter {
                it.isFile &&
                    (it.name ?: "").startsWith(AUTO_BACKUP_PREFIX) &&
                    (it.name ?: "").endsWith(".json")
            }
            .sortedByDescending { it.name ?: "" }
            .forEach { file ->
                result.put(
                    JSONObject()
                        .put("name", file.name)
                        .put("size", file.length())
                        .put("modified", file.lastModified())
                )
            }
        return result
    }

    private fun chooseAutoBackupFolder() {
        runOnUiThread {
            autoBackupFolderLauncher.launch(null)
        }
    }

    private fun listAutoBackups(uriString: String) {
        syncExecutor.execute {
            val folder = backupFolderFromUri(uriString)
            if (folder == null) {
                notifyAutoBackupCallback(
                    JSONObject().put("ok", false).put("error", "无法访问备份文件夹").toString()
                )
                return@execute
            }
            notifyAutoBackupCallback(
                JSONObject().put("ok", true).put("backups", listAutoBackupsIn(folder)).toString()
            )
        }
    }

    private fun writeAutoBackup(uriString: String, json: String, maxCount: Int, reason: String) {
        syncExecutor.execute {
            val folder = backupFolderFromUri(uriString)
            if (folder == null) {
                notifyAutoBackupCallback(
                    JSONObject().put("ok", false).put("error", "无法访问备份文件夹").toString()
                )
                return@execute
            }
            try {
                val name = AUTO_BACKUP_PREFIX + reason + "_" +
                    SimpleDateFormat("yyyyMMddHHmmssSSS", Locale.US).format(Date()) + ".json"
                val file = folder.createFile("application/json", name)
                    ?: throw Exception("创建备份文件失败")
                val stream = contentResolver.openOutputStream(file.uri)
                    ?: throw Exception("无法写入备份文件")
                stream.use { output ->
                    output.write(json.toByteArray(Charsets.UTF_8))
                }
                // 数量上限：删除最旧的超限备份
                val trimmed = JSONArray()
                val all = folder.listFiles()
                    .filter {
                        it.isFile &&
                            (it.name ?: "").startsWith(AUTO_BACKUP_PREFIX) &&
                            (it.name ?: "").endsWith(".json")
                    }
                    .sortedBy { it.name ?: "" }
                val over = all.size - maxCount.coerceAtLeast(1)
                for (i in 0 until over) {
                    if (all[i].delete()) trimmed.put(all[i].name)
                }
                notifyAutoBackupCallback(
                    JSONObject()
                        .put("ok", true)
                        .put("name", name)
                        .put("trimmed", trimmed)
                        .toString()
                )
            } catch (e: Exception) {
                notifyAutoBackupCallback(
                    JSONObject().put("ok", false).put("error", e.message ?: "写入备份失败").toString()
                )
            }
        }
    }

    private fun readAutoBackup(uriString: String, fileName: String) {
        syncExecutor.execute {
            val folder = backupFolderFromUri(uriString)
            val file = folder?.findFile(fileName)
            if (folder == null || file == null || !file.isFile) {
                notifyAutoBackupCallback(
                    JSONObject().put("ok", false).put("error", "备份文件不存在").toString()
                )
                return@execute
            }
            val content = readTextFromUri(file.uri)
            if (content == null) {
                notifyAutoBackupCallback(
                    JSONObject().put("ok", false).put("error", "读取备份文件失败").toString()
                )
                return@execute
            }
            notifyAutoBackupCallback(
                JSONObject().put("ok", true).put("content", content).toString()
            )
        }
    }

    private fun deleteAutoBackup(uriString: String, fileName: String) {
        syncExecutor.execute {
            val folder = backupFolderFromUri(uriString)
            val file = folder?.findFile(fileName)
            val ok = file != null && file.delete()
            notifyAutoBackupCallback(
                JSONObject().put("ok", ok).let { obj ->
                    if (ok) obj else obj.put("error", "删除备份失败")
                }.toString()
            )
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
        fun saveTextFile(text: String, suggestedName: String) {
            runOnUiThread {
                this@MainActivity.saveTextFile(text, suggestedName)
            }
        }

        @JavascriptInterface
        fun pickBackup() {
            runOnUiThread {
                this@MainActivity.pickBackup()
            }
        }

        @JavascriptInterface
        fun chooseBackupFolder() {
            this@MainActivity.chooseAutoBackupFolder()
        }

        @JavascriptInterface
        fun listAutoBackups(uriString: String) {
            this@MainActivity.listAutoBackups(uriString)
        }

        @JavascriptInterface
        fun writeAutoBackup(uriString: String, json: String, maxCount: Int, reason: String) {
            this@MainActivity.writeAutoBackup(uriString, json, maxCount, reason)
        }

        @JavascriptInterface
        fun readAutoBackup(uriString: String, fileName: String) {
            this@MainActivity.readAutoBackup(uriString, fileName)
        }

        @JavascriptInterface
        fun deleteAutoBackup(uriString: String, fileName: String) {
            this@MainActivity.deleteAutoBackup(uriString, fileName)
        }

        @JavascriptInterface
        fun pickBackgroundImage() {
            runOnUiThread {
                openBackgroundImageLauncher.launch(arrayOf("image/*"))
            }
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        "无法打开链接：${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
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

        @JavascriptInterface
        fun addWidget() {
            runOnUiThread {
                val appWidgetManager = AppWidgetManager.getInstance(this@MainActivity)
                val componentName = ComponentName(this@MainActivity, SleepWidgetProvider::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (appWidgetManager.isRequestPinAppWidgetSupported) {
                        appWidgetManager.requestPinAppWidget(componentName, null, null)
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            "当前启动器不支持自动添加小部件，请手动添加",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                } else {
                    Toast.makeText(
                        this@MainActivity,
                        "请手动添加小部件",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        @JavascriptInterface
        fun addCalendarEvent(title: String, description: String, beginTime: Long, endTime: Long) {
            runOnUiThread {
                val intent = Intent(Intent.ACTION_INSERT).apply {
                    data = CalendarContract.Events.CONTENT_URI
                    putExtra(CalendarContract.Events.TITLE, title)
                    putExtra(CalendarContract.Events.DESCRIPTION, description)
                    putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginTime)
                    putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endTime)
                }
                try {
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        "无法打开日历应用：${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        @JavascriptInterface
        fun setAlarm(hour: Int, minute: Int, message: String) {
            runOnUiThread {
                val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                    putExtra(AlarmClock.EXTRA_HOUR, hour)
                    putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    putExtra(AlarmClock.EXTRA_MESSAGE, message)
                    putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                }
                try {
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        "无法打开闹钟应用：${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        @JavascriptInterface
        fun getSystemTheme() {
            runOnUiThread {
                val accent = resolveThemeColor(android.R.attr.colorAccent)
                val background = resolveThemeColor(android.R.attr.colorBackground)
                val parts = mutableListOf<String>()
                if (accent != null) parts.add("\"accentColor\":\"$accent\"")
                if (background != null) parts.add("\"backgroundColor\":\"$background\"")
                val json = "{${parts.joinToString(",")}}"
                webView.evaluateJavascript(
                    "if (window.__androidSystemThemeCallback) window.__androidSystemThemeCallback('$json');",
                    null
                )
            }
        }
    }

    /** 从当前主题中解析指定属性的颜色值，解析失败返回 null。 */
    private fun resolveThemeColor(attr: Int): String? {
        return try {
            val tv = TypedValue()
            if (theme.resolveAttribute(attr, tv, true)) {
                if (tv.type == TypedValue.TYPE_STRING) {
                    tv.string?.toString()
                } else {
                    colorToHex(tv.data)
                }
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun colorToHex(color: Int): String {
        return String.format("#%06X", 0xFFFFFF and color)
    }
}
