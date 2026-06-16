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
        super.onCreate(savedInstanceState);
        // Start the keep-alive foreground service
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }


        // Request permissions (removed from startup; requested on-demand now)
        // checkAndRequestPermissions();


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
            android.content.SharedPreferences sharedPref = getSharedPreferences("SuperNotePrefs", android.content.Context.MODE_PRIVATE);
            android.content.SharedPreferences.Editor editor = sharedPref.edit();
            editor.putString("serverUrl", serverUrl);
            editor.putString("token", token);
            editor.putString("userId", userId);
            editor.apply();

            // Restart KeepAliveService to pickup new auth info
            Intent serviceIntent = new Intent(MainActivity.this, KeepAliveService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }
    }
}
