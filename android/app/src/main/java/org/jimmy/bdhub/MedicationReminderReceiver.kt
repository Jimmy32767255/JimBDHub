package org.jimmy.bdhub

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * 服药提醒接收器：到达设定的服药时间后，从 SharedPreferences 读取该时间点的所有药品，
 * 合并到一个通知（声音 + 震动）。触发后自动把该时间点排到明天（每日循环）。
 * 设备重启（BOOT_COMPLETED）或应用更新（MY_PACKAGE_REPLACED）后自动恢复调度。
 */
class MedicationReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // 设备重启 / 应用更新后恢复所有服药提醒
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            MedicationReminderScheduler.rescheduleAll(context)
            return
        }
        val timeText = intent.getStringExtra(EXTRA_TIME_TEXT) ?: return
        // 从 SharedPreferences 读取该时间点的所有药品，合并到一个通知
        val schedule = MedicationReminderScheduler.loadSchedule(context)
        val medNames = schedule[timeText] ?: emptyList()
        if (medNames.isEmpty()) return
        showReminderNotification(context, medNames, timeText)
        // 一次性闹钟已触发，重新排期把已过时间点排到明天，实现每日循环
        MedicationReminderScheduler.rescheduleAll(context)
    }

    private fun showReminderNotification(context: Context, medNames: List<String>, timeText: String) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        createChannel(notificationManager)

        // 点击通知打开应用
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = context.getString(R.string.med_reminder_title, timeText)
        val text = if (medNames.size == 1) {
            context.getString(R.string.med_reminder_text, medNames[0])
        } else {
            // 多种药品合并到同一通知，逐行列出
            medNames.joinToString("\n")
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL) // 声音 + 震动 + 灯光
            .setVibrate(longArrayOf(0, 500, 200, 500, 200, 500))

        try {
            notificationManager.notify(timeText.hashCode(), builder.build())
        } catch (e: SecurityException) {
            // 未授予通知权限时静默失败
        }
    }

    private fun createChannel(notificationManager: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "服药提醒",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "到达设定的服药时间时提醒"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "medication_reminders"
        const val EXTRA_TIME_TEXT = "time_text"
        const val ACTION_REMIND = "org.jimmy.bdhub.action.MEDICATION_REMIND"
    }
}
