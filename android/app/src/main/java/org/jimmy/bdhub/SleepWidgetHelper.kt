package org.jimmy.bdhub

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.widget.RemoteViews
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject

object SleepWidgetHelper {

    private const val PREFS_NAME = "JimBDHubWidgetPrefs"
    private const val PREF_ACTIVE_START_MS = "active_sleep_start_ms"
    private const val PREF_PENDING_RECORDS = "pending_sleep_records_json"
    private const val PREF_LAST_ACTION_MS = "last_action_ms"

    private const val ACTION_SLEEP_CLICK = "org.jimmy.bdhub.action.WIDGET_SLEEP_CLICK"
    private const val MIN_SLEEP_DURATION_MS = 60_000L

    data class PendingSleep(val startMs: Long, val endMs: Long)

    fun isSleeping(context: Context): Boolean {
        return getPrefs(context).getLong(PREF_ACTIVE_START_MS, 0L) > 0L
    }

    fun getLastActionMs(context: Context): Long {
        return getPrefs(context).getLong(PREF_LAST_ACTION_MS, 0L)
    }

    fun onSleepClick(context: Context) {
        val prefs = getPrefs(context)
        val activeStart = prefs.getLong(PREF_ACTIVE_START_MS, 0L)
        val now = System.currentTimeMillis()

        if (activeStart == 0L) {
            prefs.edit {
                putLong(PREF_ACTIVE_START_MS, now)
                    .putLong(PREF_LAST_ACTION_MS, now)
            }
            showToast(context, context.getString(R.string.widget_toast_started))
        } else {
            val endMs = if (now <= activeStart) activeStart + MIN_SLEEP_DURATION_MS else now
            val record = PendingSleep(activeStart, endMs)
            val queue = loadPendingQueue(prefs) + record
            prefs.edit {
                remove(PREF_ACTIVE_START_MS)
                    .putString(PREF_PENDING_RECORDS, serializeQueue(queue))
                    .putLong(PREF_LAST_ACTION_MS, now)
            }
            showToast(context, context.getString(R.string.widget_toast_recorded))
            launchMainActivity(context)
        }

        updateAllWidgets(context)
    }

    fun consumePendingRecords(context: Context): List<PendingSleep> {
        val prefs = getPrefs(context)
        val queue = loadPendingQueue(prefs)
        if (queue.isNotEmpty()) {
            prefs.edit { remove(PREF_PENDING_RECORDS) }
        }
        return queue
    }

    fun updateAllWidgets(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val componentName = ComponentName(context, SleepWidgetProvider::class.java)
        val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.sleep_widget)
        val sleeping = isSleeping(context)

        if (sleeping) {
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_title_stop))
            views.setTextViewText(
                R.id.widget_subtitle,
                context.getString(R.string.widget_subtitle_started)
            )
        } else {
            views.setTextViewText(
                R.id.widget_title,
                context.getString(R.string.widget_title_record)
            )
            val lastAction = getLastActionMs(context)
            val subtitle = if (lastAction > 0L) {
                formatTimeAgo(context, lastAction)
            } else {
                context.getString(R.string.widget_subtitle_start)
            }
            views.setTextViewText(R.id.widget_subtitle, subtitle)
        }

        val clickIntent = Intent(context, SleepWidgetActionReceiver::class.java).apply {
            action = ACTION_SLEEP_CLICK
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun formatTimeAgo(context: Context, timestamp: Long): String {
        val diff = System.currentTimeMillis() - timestamp
        val minutes = diff / 60_000L
        return when {
            minutes < 1 -> context.getString(R.string.widget_subtitle_start)
            minutes < 60 -> context.getString(R.string.widget_time_ago_minutes, minutes)
            else -> context.getString(R.string.widget_time_ago_hours, minutes / 60)
        }
    }

    private fun launchMainActivity(context: Context) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_FROM_WIDGET, true)
        }
        context.startActivity(intent)
    }

    private fun getPrefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun loadPendingQueue(prefs: SharedPreferences): List<PendingSleep> {
        val json = prefs.getString(PREF_PENDING_RECORDS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            List(arr.length()) { i ->
                val obj = arr.getJSONObject(i)
                PendingSleep(obj.getLong("startMs"), obj.getLong("endMs"))
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun serializeQueue(queue: List<PendingSleep>): String {
        val arr = JSONArray()
        for (record in queue) {
            arr.put(JSONObject().apply {
                put("startMs", record.startMs)
                put("endMs", record.endMs)
            })
        }
        return arr.toString()
    }

    private fun showToast(context: Context, message: String) {
        android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_SHORT).show()
    }
}
