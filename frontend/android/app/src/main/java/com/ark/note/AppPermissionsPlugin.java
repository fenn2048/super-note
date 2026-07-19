package com.ark.note;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import java.io.BufferedReader;
import java.io.InputStreamReader;

@CapacitorPlugin(
    name = "AppPermissions",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera"),
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class AppPermissionsPlugin extends Plugin {

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
        }
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
        }
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void exportLogs(PluginCall call) {
        try {
            // Use PID-filtered logcat to capture this app's own logs.
            // On Android 11+ (API 30+), regular apps cannot read system-wide logs;
            // filtering by PID returns the app's own log output.
            int pid = android.os.Process.myPid();
            Process process = Runtime.getRuntime().exec(
                new String[] { "logcat", "-d", "-v", "threadtime", "--pid=" + pid }
            );
            BufferedReader bufferedReader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );

            StringBuilder log = new StringBuilder();
            log.append("=== Super Note App Logs ===\n");
            log.append("Package: ").append(getContext().getPackageName()).append("\n");
            log.append("PID: ").append(pid).append("\n");
            log.append("Android: ").append(Build.VERSION.RELEASE)
              .append(" (SDK ").append(Build.VERSION.SDK_INT).append(")\n");
            log.append("===========================\n\n");

            String line;
            boolean hasContent = false;
            while ((line = bufferedReader.readLine()) != null) {
                log.append(line).append("\n");
                hasContent = true;
            }
            process.waitFor();

            if (!hasContent) {
                log.append("\n(应用运行日志为空 — 可能设备限制了 logcat 读取权限)\n");
                log.append("请尝试通过以下方式获取日志：\n");
                log.append("1. 使用 Android Studio 的 Logcat 工具\n");
                log.append("2. 或在终端执行: adb logcat -d --pid=").append(pid).append("\n");
            }

            // Write to a cache file
            java.io.File cacheDir = getContext().getCacheDir();
            java.io.File logFile = new java.io.File(cacheDir, "super_note_logs.txt");
            java.io.FileWriter writer = new java.io.FileWriter(logFile);
            writer.write(log.toString());
            writer.close();

            // Get URI using FileProvider
            android.net.Uri fileUri = androidx.core.content.FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                logFile
            );

            // Create share intent
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_STREAM, fileUri);
            intent.putExtra(Intent.EXTRA_SUBJECT, "Super Note 运行日志");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // Start chooser
            Intent chooser = Intent.createChooser(intent, "导出日志");
            getActivity().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("hasContent", hasContent);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "导出日志失败: " + e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean isIgnoring = false;
        if (pm != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                isIgnoring = pm.isIgnoringBatteryOptimizations(context.getPackageName());
            } else {
                isIgnoring = true;
            }
        }
        JSObject ret = new JSObject();
        ret.put("isIgnoring", isIgnoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开电池优化设置: " + e.getMessage(), e);
        }
    }

    /** 创建/对齐通知渠道（任务/消息/同步） */
    @PluginMethod
    public void ensureNotificationChannels(PluginCall call) {
        try {
            NotificationChannels.ensureAll(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("ensureNotificationChannels failed: " + e.getMessage(), e);
        }
    }

    /** 后台消息保活是否开启（默认 false） */
    @PluginMethod
    public void isBackgroundKeepAliveEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", KeepAliveService.isEnabled(getContext()));
        call.resolve(ret);
    }

    /**
     * 开关后台消息前台服务。
     * body: { enabled: boolean }
     */
    @PluginMethod
    public void setBackgroundKeepAliveEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        boolean on = enabled != null && enabled;
        Context ctx = getContext();
        try {
            KeepAliveService.setEnabled(ctx, on);
            if (on) {
                NotificationChannels.ensureAll(ctx);
                KeepAliveService.startIfEnabled(ctx);
            } else {
                KeepAliveService.stop(ctx);
            }
            JSObject ret = new JSObject();
            ret.put("enabled", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("setBackgroundKeepAliveEnabled failed: " + e.getMessage(), e);
        }
    }

    /** 打开系统通知设置（渠道管理） */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开通知设置: " + e.getMessage(), e);
        }
    }
}
