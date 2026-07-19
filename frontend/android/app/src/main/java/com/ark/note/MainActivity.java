package com.ark.note;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(ShareReceivePlugin.class);
        super.onCreate(savedInstanceState);

        // 通知渠道（任务/消息/同步）；KeepAlive 默认关闭，仅用户开启后 startIfEnabled
        NotificationChannels.ensureAll(this);
        KeepAliveService.startIfEnabled(this);

        // 系统分享 / 冷启动 Intent
        handleIncomingIntent(getIntent());

        // Inject download bridge and customize WebChromeClient for permissions
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new AndroidDownloadBridge(), "AndroidDownloadBridge");
            this.bridge.getWebView().addJavascriptInterface(new AndroidKeepAliveBridge(), "AndroidKeepAliveBridge");

            this.bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                    runOnUiThread(() -> {
                        request.grant(request.getResources());
                    });
                }
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // singleTask：后台再被分享唤起时走这里
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    /**
     * 解析并消费分享 Intent；VIEW（微信文章）留给 Capacitor App plugin 的 appUrlOpen。
     */
    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ShareReceivePlugin.queueFromIntent(this, intent);
            // 防止旋转/重建时重复入队
            intent.setAction(Intent.ACTION_MAIN);
            intent.removeExtra(Intent.EXTRA_TEXT);
            intent.removeExtra(Intent.EXTRA_STREAM);
            intent.removeExtra(Intent.EXTRA_SUBJECT);
        }
    }

    private void checkAndRequestPermissions() {
        List<String> listPermissionsNeeded = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            listPermissionsNeeded.add(Manifest.permission.CAMERA);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            listPermissionsNeeded.add(Manifest.permission.RECORD_AUDIO);
        }
        if (android.os.Build.VERSION.SDK_INT <= android.os.Build.VERSION_CODES.P) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                listPermissionsNeeded.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }
        if (!listPermissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(this, listPermissionsNeeded.toArray(new String[0]), 101);
        }
    }

    public class AndroidDownloadBridge {
        @JavascriptInterface
        public void downloadFile(String base64Data, String filename, String mimeType) {
            try {
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            if (os != null) {
                                os.write(data);
                                os.flush();
                                runOnUiThread(() -> Toast.makeText(MainActivity.this, "文件已保存至下载目录: " + filename, Toast.LENGTH_LONG).show());
                            }
                        }
                    } else {
                        throw new IOException("Failed to create MediaStore entry");
                    }
                } else {
                    java.io.File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloadDir.exists()) {
                        downloadDir.mkdirs();
                    }
                    java.io.File file = new java.io.File(downloadDir, filename);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(file)) {
                        fos.write(data);
                        fos.flush();
                        runOnUiThread(() -> Toast.makeText(MainActivity.this, "文件已保存至下载目录: " + filename, Toast.LENGTH_LONG).show());
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "保存文件失败: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }

    public class AndroidKeepAliveBridge {
        @JavascriptInterface
        public void updateAuthInfo(String serverUrl, String token, String userId) {
            android.content.SharedPreferences sharedPref =
                    getSharedPreferences(KeepAliveService.PREFS, android.content.Context.MODE_PRIVATE);
            sharedPref.edit()
                    .putString("serverUrl", serverUrl != null ? serverUrl : "")
                    .putString("token", token != null ? token : "")
                    .putString("userId", userId != null ? userId : "")
                    .apply();

            // 仅在用户已开启后台保活时重启服务以刷新凭证
            if (KeepAliveService.isEnabled(MainActivity.this)) {
                KeepAliveService.stop(MainActivity.this);
                KeepAliveService.startIfEnabled(MainActivity.this);
            }
        }
    }
}
