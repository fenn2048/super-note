package com.ark.note;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

/**
 * PackageInstaller 会话回调：弹出系统「安装此应用」确认框。
 */
public class ApkInstallReceiver extends BroadcastReceiver {
    public static final String ACTION = "com.ark.note.INSTALL_STATUS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                } catch (Exception e) {
                    Toast.makeText(context, "无法打开安装界面: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(context, "安装完成", Toast.LENGTH_SHORT).show();
            return;
        }
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            return;
        }
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Toast.makeText(
                context,
                "安装失败" + (msg != null && !msg.isEmpty() ? ": " + msg : ""),
                Toast.LENGTH_LONG
        ).show();
    }
}
