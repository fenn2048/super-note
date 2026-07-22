package com.ark.note;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;

import java.io.BufferedReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 专业持久化日志框架：
 *   - 异步线程安全写入 app 内部存储 logs 目录
 *   - 支持文件自动轮转（单文件 max 2MB，最多保留 3 个历史文件）
 *   - 涵盖 Java 原生 Service/生命周期/未捕获崩溃堆栈 + JS 侧 API/播放器/网络埋点日志
 */
public class AppLogger {
    private static final String TAG = "AppLogger";
    private static final long MAX_FILE_SIZE = 2 * 1024 * 1024L; // 2MB
    private static final int MAX_FILES = 3;

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);

    private static File logDir;
    private static File currentLogFile;
    private static boolean initialized = false;

    public static synchronized void init(final Context context) {
        if (initialized) return;
        try {
            logDir = new File(context.getFilesDir(), "logs");
            if (!logDir.exists()) {
                logDir.mkdirs();
            }
            currentLogFile = new File(logDir, "app_current.log");
            initialized = true;

            // 注册 Java 全局未捕获崩溃拦截器
            final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
                @Override
                public void uncaughtException(Thread t, Throwable e) {
                    e("CrashHandler", "FATAL UNCAUGHT EXCEPTION in thread " + t.getName(), e);
                    if (defaultHandler != null) {
                        defaultHandler.uncaughtException(t, e);
                    }
                }
            });

            i("AppLogger", "=== AppLogger Initialized. App Started. Android API " + Build.VERSION.SDK_INT + " ===");
        } catch (Exception e) {
            Log.e(TAG, "Failed to init AppLogger", e);
        }
    }

    public static void d(String tag, String msg) {
        log("DEBUG", tag, msg, null);
    }

    public static void i(String tag, String msg) {
        log("INFO", tag, msg, null);
    }

    public static void w(String tag, String msg) {
        log("WARN", tag, msg, null);
    }

    public static void e(String tag, String msg) {
        log("ERROR", tag, msg, null);
    }

    public static void e(String tag, String msg, Throwable tr) {
        log("ERROR", tag, msg, tr);
    }

    private static void log(final String level, final String tag, final String msg, final Throwable tr) {
        Log.println(getLevelPriority(level), tag, msg + (tr != null ? "\n" + getStackTraceString(tr) : ""));
        if (!initialized || currentLogFile == null) return;

        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    checkRotate();
                    String timeStr;
                    synchronized (dateFormat) {
                        timeStr = dateFormat.format(new Date());
                    }
                    StringBuilder sb = new StringBuilder();
                    sb.append("[").append(timeStr).append("] ")
                      .append("[").append(level).append("] ")
                      .append("[").append(tag).append("] ")
                      .append(msg);
                    if (tr != null) {
                        sb.append("\n").append(getStackTraceString(tr));
                    }
                    sb.append("\n");

                    FileWriter writer = new FileWriter(currentLogFile, true);
                    writer.write(sb.toString());
                    writer.flush();
                    writer.close();
                } catch (Exception e) {
                    Log.e(TAG, "Write log failed", e);
                }
            }
        });
    }

    private static int getLevelPriority(String level) {
        switch (level) {
            case "DEBUG": return Log.DEBUG;
            case "WARN": return Log.WARN;
            case "ERROR": return Log.ERROR;
            default: return Log.INFO;
        }
    }

    private static String getStackTraceString(Throwable tr) {
        if (tr == null) return "";
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        tr.printStackTrace(pw);
        pw.flush();
        return sw.toString();
    }

    private static void checkRotate() {
        if (currentLogFile != null && currentLogFile.exists() && currentLogFile.length() > MAX_FILE_SIZE) {
            try {
                // rotate: app_current.log -> app_1.log, app_1.log -> app_2.log
                for (int i = MAX_FILES - 1; i >= 1; i--) {
                    File oldFile = new File(logDir, "app_" + i + ".log");
                    if (oldFile.exists()) {
                        if (i == MAX_FILES - 1) {
                            oldFile.delete();
                        } else {
                            File newFile = new File(logDir, "app_" + (i + 1) + ".log");
                            oldFile.renameTo(newFile);
                        }
                    }
                }
                File firstHistory = new File(logDir, "app_1.log");
                currentLogFile.renameTo(firstHistory);
                currentLogFile = new File(logDir, "app_current.log");
            } catch (Exception e) {
                Log.e(TAG, "Rotate log failed", e);
            }
        }
    }

    /**
     * 读取并合并所有持久化日志文件内容供导出
     */
    public static String readAllLogs(Context context) {
        init(context);
        StringBuilder sb = new StringBuilder();
        sb.append("========================================\n");
        sb.append(" Super Note 日志诊断报告\n");
        sb.append(" 包名: ").append(context.getPackageName()).append("\n");
        sb.append(" PID: ").append(android.os.Process.myPid()).append("\n");
        sb.append(" Android 版本: ").append(Build.VERSION.RELEASE).append(" (SDK ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append(" 设备型号: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n");
        sb.append(" 导出时间: ").append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())).append("\n");
        sb.append("========================================\n\n");

        if (logDir == null || !logDir.exists()) {
            sb.append("(日志目录不存在)\n");
            return sb.toString();
        }

        // 挨个读取历史日志和当前日志
        for (int i = MAX_FILES - 1; i >= 1; i--) {
            File f = new File(logDir, "app_" + i + ".log");
            if (f.exists()) {
                sb.append("--- 历史日志片段 (").append(f.getName()).append(") ---\n");
                appendFileContent(f, sb);
                sb.append("\n");
            }
        }
        if (currentLogFile != null && currentLogFile.exists()) {
            sb.append("--- 最新日志记录 (app_current.log) ---\n");
            appendFileContent(currentLogFile, sb);
            sb.append("\n");
        }

        return sb.toString();
    }

    private static void appendFileContent(File file, StringBuilder sb) {
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
        } catch (Exception e) {
            sb.append("(读取文件失败: ").append(e.getMessage()).append(")\n");
        }
    }
}
