package com.rishu.fridayos;

import android.content.Context;
import android.os.Build;

import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/** User-initiated, sanitized crash/logcat diagnostics. No provider keys are included. */
@CapacitorPlugin(name = "FridayDiagnostics")
public final class FridayDiagnostics extends Plugin {
    private static volatile boolean installed;

    @Override
    public void load() {
        installCrashHandler(getContext().getApplicationContext());
    }

    public static synchronized void installCrashHandler(Context context) {
        if (installed) return;
        installed = true;
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                File dir = new File(context.getFilesDir(), "diagnostics");
                if (dir.exists() || dir.mkdirs()) {
                    File out = new File(dir, "crash-" + System.currentTimeMillis() + ".log");
                    try (PrintWriter writer = new PrintWriter(new FileOutputStream(out))) {
                        writer.println("FRIDAY OS native crash");
                        writer.println("time=" + isoNow());
                        writer.println("thread=" + thread.getName());
                        writer.println("android=" + Build.VERSION.RELEASE + " sdk=" + Build.VERSION.SDK_INT);
                        error.printStackTrace(writer);
                    }
                    trimOld(dir, 5);
                }
            } catch (Throwable ignored) {}
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    @PluginMethod
    public void collect(PluginCall call) {
        new Thread(() -> {
            try {
                StringBuilder report = new StringBuilder(256 * 1024);
                report.append("FRIDAY OS SANITIZED DIAGNOSTICS\n")
                        .append("generated=").append(isoNow()).append('\n')
                        .append("android=").append(Build.VERSION.RELEASE)
                        .append(" sdk=").append(Build.VERSION.SDK_INT)
                        .append(" device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
                        .append("app=").append(getContext().getPackageName()).append('\n');
                try {
                    String version = getContext().getPackageManager()
                            .getPackageInfo(getContext().getPackageName(), 0).versionName;
                    report.append("version=").append(version).append('\n');
                } catch (Throwable ignored) {}

                report.append("\n=== DOWNLOAD JOBS ===\n");
                try {
                    List<WorkInfo> jobs = WorkManager.getInstance(getContext())
                            .getWorkInfosByTag("friday-download").get(8, TimeUnit.SECONDS);
                    int from = Math.max(0, jobs.size() - 20);
                    for (int i = from; i < jobs.size(); i++) {
                        WorkInfo job = jobs.get(i);
                        report.append(job.getId()).append(' ').append(job.getState())
                                .append(" progress=").append(job.getProgress().getInt("percent", 0)).append('%');
                        String error = job.getOutputData().getString("error");
                        if (error != null) report.append(" error=").append(error);
                        report.append('\n');
                    }
                } catch (Throwable error) { report.append("unavailable=").append(error.getClass().getSimpleName()).append('\n'); }

                report.append("\n=== SAVED NATIVE CRASHES ===\n");
                File dir = new File(getContext().getFilesDir(), "diagnostics");
                File[] crashes = dir.listFiles((d, name) -> name.startsWith("crash-") && name.endsWith(".log"));
                if (crashes != null) {
                    Arrays.sort(crashes, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (int i = 0; i < Math.min(3, crashes.length) && report.length() < 160_000; i++) {
                        report.append("\n--- ").append(crashes[i].getName()).append(" ---\n")
                                .append(readLimited(crashes[i], 48_000));
                    }
                }

                report.append("\n=== LOGCAT (CURRENT APP PROCESS) ===\n");
                appendLogcat(report, 90_000);
                String sanitized = sanitize(report.toString());
                if (sanitized.length() > 250_000) sanitized = sanitized.substring(0, 250_000) + "\n[truncated]\n";
                JSObject result = new JSObject();
                result.put("ok", true); result.put("text", sanitized);
                result.put("crashCount", crashes == null ? 0 : crashes.length);
                call.resolve(result);
            } catch (Throwable error) {
                JSObject result = new JSObject(); result.put("ok", false);
                result.put("reason", error.getClass().getSimpleName()); call.resolve(result);
            }
        }, "friday-diagnostics").start();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "diagnostics");
        File[] files = dir.listFiles();
        int deleted = 0;
        if (files != null) for (File file : files) if (file.delete()) deleted++;
        JSObject out = new JSObject(); out.put("ok", true); out.put("deleted", deleted); call.resolve(out);
    }

    private static void appendLogcat(StringBuilder out, int limit) {
        Process process = null;
        try {
            process = new ProcessBuilder("logcat", "-d", "-t", "500", "--pid=" + android.os.Process.myPid())
                    .redirectErrorStream(true).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line; int added = 0;
                while ((line = reader.readLine()) != null && added < limit) {
                    int take = Math.min(line.length(), limit - added);
                    out.append(line, 0, take).append('\n'); added += take + 1;
                }
            }
            process.waitFor(3, TimeUnit.SECONDS);
        } catch (Throwable error) {
            out.append("logcat unavailable: ").append(error.getClass().getSimpleName()).append('\n');
        } finally { if (process != null) process.destroy(); }
    }

    private static String readLimited(File file, int limit) {
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null && out.length() < limit) out.append(line).append('\n');
        } catch (Throwable ignored) {}
        return out.toString();
    }

    private static String sanitize(String text) {
        String out = text;
        out = out.replaceAll("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[^\\s]+", "$1[REDACTED]");
        out = out.replaceAll("(?i)((?:api[_-]?key|token|secret|password)\\s*[:=]\\s*)[^\\s,;]+", "$1[REDACTED]");
        out = out.replaceAll("\\b(gsk_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,})\\b", "[REDACTED_KEY]");
        out = out.replaceAll("([?&](?:token|key|signature|sig|auth)=)[^&\\s]+", "$1[REDACTED]");
        return out;
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC")); return fmt.format(new Date());
    }

    private static void trimOld(File dir, int keep) {
        File[] files = dir.listFiles((d, name) -> name.startsWith("crash-") && name.endsWith(".log"));
        if (files == null || files.length <= keep) return;
        Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = keep; i < files.length; i++) files[i].delete();
    }
}
