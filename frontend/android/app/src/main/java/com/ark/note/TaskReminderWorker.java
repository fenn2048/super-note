package com.ark.note;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * 每 15 分钟拉一次任务/通知（不依赖 WebView）。
 * 桌面创建的提醒，手机休眠时也能在下次窗口内排闹钟或补发通知。
 */
public class TaskReminderWorker extends Worker {
    private static final String TAG = "TaskReminderWorker";
    private static final String UNIQUE_PERIODIC = "fuyou-task-reminder-sync";
    private static final String UNIQUE_ONCE = "fuyou-task-reminder-sync-once";

    public TaskReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            TaskReminderSync.run(getApplicationContext());
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "doWork", e);
            return Result.retry();
        }
    }

    public static void enqueue(Context ctx) {
        Constraints net = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(
                TaskReminderWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(net)
                .build();
        WorkManager.getInstance(ctx.getApplicationContext()).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                periodic
        );
        enqueueNow(ctx);
    }

    /** 登录后立刻跑一轮，尽快排上桌面新创建的提醒 */
    public static void enqueueNow(Context ctx) {
        Constraints net = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest once = new OneTimeWorkRequest.Builder(TaskReminderWorker.class)
                .setConstraints(net)
                .build();
        WorkManager.getInstance(ctx.getApplicationContext()).enqueueUniqueWork(
                UNIQUE_ONCE,
                ExistingWorkPolicy.REPLACE,
                once
        );
    }
}
