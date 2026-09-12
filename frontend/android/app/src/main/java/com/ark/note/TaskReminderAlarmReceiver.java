package com.ark.note;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 精确闹钟到点 / 开机后重新入队 WorkManager。
 */
public class TaskReminderAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "TaskReminderAlarm";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.i(TAG, "boot → enqueue worker");
            TaskReminderWorker.enqueue(context.getApplicationContext());
            return;
        }
        if (TaskReminderSync.ACTION_FIRE.equals(action)) {
            TaskReminderSync.fireFromAlarm(context.getApplicationContext(), intent);
        }
    }
}
