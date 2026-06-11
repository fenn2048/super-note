package com.nowen.note;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.Manifest;
import android.content.Intent;
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
            requestPermissionForAlias("camera", call, "permissionCallback");
        }
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("microphone", call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        boolean cameraGranted = getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED;
        boolean micGranted = getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED;
        ret.put("cameraGranted", cameraGranted);
        ret.put("microphoneGranted", micGranted);
        call.resolve(ret);
    }

    @PluginMethod
    public void exportLogs(PluginCall call) {
        try {
            // Run logcat command to dump logs
            Process process = Runtime.getRuntime().exec("logcat -d");
            BufferedReader bufferedReader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );

            StringBuilder log = new StringBuilder();
            String line;
            while ((line = bufferedReader.readLine()) != null) {
                log.append(line).append("\n");
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
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // Start chooser
            Intent chooser = Intent.createChooser(intent, "导出日志");
            getActivity().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("导出日志失败: " + e.getMessage(), e);
        }
    }
}
