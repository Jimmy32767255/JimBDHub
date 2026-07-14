package org.jimmy.bdhub

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SleepWidgetActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_SLEEP_CLICK) {
            SleepWidgetHelper.onSleepClick(context)
        }
    }

    companion object {
        const val ACTION_SLEEP_CLICK = "org.jimmy.bdhub.action.WIDGET_SLEEP_CLICK"
    }
}
