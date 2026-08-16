package org.jimmy.bdhub

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * 服药提醒调度：按"时间点"调度（而非按药品），同一时间点的所有药品合并到一个通知。
 * 提醒数据持久化到 SharedPreferences，应用关闭/重启后仍可触发。
 * 每次闹钟触发后 Receiver 会调用 [rescheduleAll] 把已过时间点排到明天，实现每日循环。
 */
object MedicationReminderScheduler {

    private const val PREFS_NAME = "JimBDHubReminders"
    private const val KEY_SCHEDULE = "schedule_json"
    private const val KEY_SCHEDULED_TIMES = "scheduled_times_json"
    private const val REQUEST_BASE = 30000

    /**
     * 更新全部服药提醒（全量替换）。
     * @param scheduleJson 调度数据 JSON：{ "08:00": ["碳酸锂 1片", "喹硫平 0.5片"], "20:00": [...] }
     */
    fun updateSchedule(context: Context, scheduleJson: String) {
        val prefs = getPrefs(context)
        prefs.edit().putString(KEY_SCHEDULE, scheduleJson).apply()
        rescheduleAll(context)
    }

    /** 从 SharedPreferences 读取调度数据，返回 { "HH:mm": [药品名...] } */
    fun loadSchedule(context: Context): Map<String, List<String>> {
        val raw = getPrefs(context).getString(KEY_SCHEDULE, null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            val result = mutableMapOf<String, List<String>>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val time = keys.next()
                val arr = obj.optJSONArray(time) ?: continue
                val meds = (0 until arr.length()).map { arr.getString(it) }
                if (meds.isNotEmpty()) result[time] = meds
            }
            result
        } catch (e: Exception) {
            emptyMap()
        }
    }

    /**
     * 重新调度所有提醒（全量重建）。
     * 先取消上次记录的时间点闹钟，再为每个时间点设置新的"最近一次未来时间"闹钟，
     * 最后把本次排期的时间点保存下来供下次取消。
     * 通知触发后调用本方法即可把已过时间点自动排到明天（每日循环）。
     */
    fun rescheduleAll(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancelScheduled(context)
        val schedule = loadSchedule(context)
        if (schedule.isEmpty()) {
            getPrefs(context).edit().remove(KEY_SCHEDULED_TIMES).apply()
            return
        }

        val scheduledTimes = mutableListOf<String>()
        schedule.forEach { (time, medNames) ->
            val parts = time.split(":")
            if (parts.size < 2) return@forEach
            val hour = parts[0].toIntOrNull() ?: return@forEach
            val minute = parts[1].toIntOrNull() ?: return@forEach

            val calendar = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (timeInMillis <= System.currentTimeMillis()) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }

            val intent = Intent(context, MedicationReminderReceiver::class.java).apply {
                action = MedicationReminderReceiver.ACTION_REMIND
                putExtra(MedicationReminderReceiver.EXTRA_TIME_TEXT, time)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCodeForTime(time),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            try {
                if (canUseExactAlarm(alarmManager)) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        calendar.timeInMillis,
                        pendingIntent
                    )
                } else {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        calendar.timeInMillis,
                        pendingIntent
                    )
                }
                scheduledTimes.add(time)
            } catch (e: Exception) {
                // 精确闹钟权限被拒绝时降级为非精确
                try {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        calendar.timeInMillis,
                        pendingIntent
                    )
                    scheduledTimes.add(time)
                } catch (e2: Exception) {
                    // 忽略
                }
            }
        }
        getPrefs(context).edit()
            .putString(KEY_SCHEDULED_TIMES, JSONArray(scheduledTimes).toString())
            .apply()
    }

    /**
     * 是否可以使用精确闹钟：
     * - Android 13+（TIRAMISU）：声明了 USE_EXACT_ALARM 即默认可用，无需用户授权
     * - Android 12（S）：需要 canScheduleExactAlarms()
     * - Android 11 及以下：精确闹钟默认可用
     */
    fun canUseExactAlarm(alarmManager: AlarmManager): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // USE_EXACT_ALARM 已声明，闹钟类应用默认拥有精确闹钟能力
            true
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }
    }

    /** 精确闹钟是否真正可用（Android 13+ 恒为 true） */
    fun isExactAlarmGranted(context: Context): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return canUseExactAlarm(alarmManager)
    }

    /** 取消所有提醒并清空调度数据 */
    fun cancelAll(context: Context) {
        cancelScheduled(context)
        getPrefs(context).edit()
            .remove(KEY_SCHEDULE)
            .remove(KEY_SCHEDULED_TIMES)
            .apply()
    }

    /** 只取消上次排期过的时间点闹钟（避免遍历全部 1440 分钟） */
    private fun cancelScheduled(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val times = loadScheduledTimes(context)
        times.forEach { time ->
            val intent = Intent(context, MedicationReminderReceiver::class.java).apply {
                action = MedicationReminderReceiver.ACTION_REMIND
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCodeForTime(time),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
    }

    private fun loadScheduledTimes(context: Context): List<String> {
        val raw = getPrefs(context).getString(KEY_SCHEDULED_TIMES, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** 用"当天分钟数"作为唯一 requestCode（0..1439），避免哈希冲突 */
    private fun requestCodeForTime(time: String): Int {
        val parts = time.split(":")
        val hour = parts.getOrNull(0)?.toIntOrNull() ?: 0
        val minute = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return REQUEST_BASE + (hour * 60 + minute)
    }

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }
}

