package com.rishu.fridayos;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Capacitor bridge for the persistent WorkManager download queue. */
@CapacitorPlugin(name = "FridayDownloads")
public final class FridayDownloads extends Plugin {
    private JSObject fail(String reason) {
        JSObject out = new JSObject(); out.put("ok", false); out.put("reason", reason); return out;
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        String url = call.getString("url", "").trim();
        String dest = call.getString("dest", "").trim();
        String sha256 = call.getString("sha256", "").trim();
        Long expected = call.getLong("expectedBytes", 0L);
        Boolean extract = call.getBoolean("extractZip", false);
        Boolean stripTop = call.getBoolean("stripTopLevel", false);
        if (!url.startsWith("https://")) { call.resolve(fail("https_required")); return; }
        if (!safeRelative(dest)) { call.resolve(fail("invalid_destination")); return; }
        Data input = new Data.Builder()
                .putString(FridayDownloadWorker.KEY_MODE, "url")
                .putString(FridayDownloadWorker.KEY_URL, url)
                .putString(FridayDownloadWorker.KEY_DEST, dest)
                .putString(FridayDownloadWorker.KEY_SHA256, sha256)
                .putLong(FridayDownloadWorker.KEY_EXPECTED, expected == null ? 0 : expected)
                .putBoolean(FridayDownloadWorker.KEY_EXTRACT_ZIP, Boolean.TRUE.equals(extract))
                .putBoolean(FridayDownloadWorker.KEY_STRIP_TOP_LEVEL, Boolean.TRUE.equals(stripTop)).build();
        enqueueUnique(call, "url:" + dest, input);
    }

    @PluginMethod
    public void enqueueHuggingFace(PluginCall call) {
        String repo = call.getString("repo", "").trim();
        String dest = call.getString("dest", "").trim();
        if (!repo.matches("^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$")) {
            call.resolve(fail("invalid_repo")); return;
        }
        if (!dest.matches("^[A-Za-z0-9._-]{1,100}$")) {
            call.resolve(fail("invalid_destination")); return;
        }
        Data input = new Data.Builder()
                .putString(FridayDownloadWorker.KEY_MODE, "hf_repo")
                .putString(FridayDownloadWorker.KEY_REPO, repo)
                .putString(FridayDownloadWorker.KEY_DEST, dest).build();
        enqueueUnique(call, "hf:" + repo + ":" + dest, input);
    }

    private void enqueueUnique(final PluginCall call, final String identity, final Data input) {
        new Thread(() -> {
            try {
                WorkManager manager = WorkManager.getInstance(getContext());
                String name = "friday-download-" + shortHash(identity);
                List<WorkInfo> previous = manager.getWorkInfosForUniqueWork(name).get(10, TimeUnit.SECONDS);
                WorkInfo reusable = null;
                for (int i = previous.size() - 1; i >= 0; i--) {
                    WorkInfo candidate = previous.get(i);
                    if (!candidate.getState().isFinished() || candidate.getState() == WorkInfo.State.SUCCEEDED) {
                        reusable = candidate; break;
                    }
                }
                if (reusable != null) { call.resolve(pack(reusable)); return; }

                Constraints constraints = new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresStorageNotLow(true).build();
                OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FridayDownloadWorker.class)
                        .setConstraints(constraints)
                        .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                        .setInputData(input).addTag("friday-download").addTag(name).build();
                manager.enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
                        .getResult().get(10, TimeUnit.SECONDS);
                WorkInfo queued = manager.getWorkInfoById(request.getId()).get(10, TimeUnit.SECONDS);
                call.resolve(queued == null ? fail("enqueue_failed") : pack(queued));
            } catch (Throwable error) {
                call.resolve(fail(safeReason(error)));
            }
        }, "friday-download-enqueue").start();
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = call.getString("jobId", "");
        new Thread(() -> {
            try {
                WorkInfo info = WorkManager.getInstance(getContext())
                        .getWorkInfoById(UUID.fromString(id)).get(10, TimeUnit.SECONDS);
                call.resolve(info == null ? fail("not_found") : pack(info));
            } catch (Throwable error) { call.resolve(fail(safeReason(error))); }
        }, "friday-download-status").start();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("jobId", "");
        try {
            WorkManager.getInstance(getContext()).cancelWorkById(UUID.fromString(id));
            JSObject out = new JSObject(); out.put("ok", true); out.put("jobId", id); call.resolve(out);
        } catch (Throwable error) { call.resolve(fail("invalid_job")); }
    }

    @PluginMethod
    public void jobs(PluginCall call) {
        new Thread(() -> {
            try {
                List<WorkInfo> infos = WorkManager.getInstance(getContext())
                        .getWorkInfosByTag("friday-download").get(10, TimeUnit.SECONDS);
                JSArray jobs = new JSArray();
                int start = Math.max(0, infos.size() - 30);
                for (int i = infos.size() - 1; i >= start; i--) jobs.put(pack(infos.get(i)));
                JSObject out = new JSObject(); out.put("ok", true); out.put("jobs", jobs); call.resolve(out);
            } catch (Throwable error) { call.resolve(fail(safeReason(error))); }
        }, "friday-download-jobs").start();
    }

    private JSObject pack(WorkInfo info) {
        Data progress = info.getProgress();
        Data output = info.getOutputData();
        JSObject out = new JSObject();
        out.put("ok", info.getState() != WorkInfo.State.FAILED && info.getState() != WorkInfo.State.CANCELLED);
        out.put("jobId", info.getId().toString());
        out.put("state", info.getState().name().toLowerCase(Locale.US));
        out.put("percent", progress.getInt("percent", info.getState() == WorkInfo.State.SUCCEEDED ? 100 : 0));
        out.put("file", progress.getString("file") == null ? "" : progress.getString("file"));
        out.put("bytes", progress.getLong("bytes", 0));
        out.put("totalBytes", progress.getLong("total_bytes", 0));
        out.put("path", output.getString("path") == null ? "" : output.getString("path"));
        String error = output.getString("error");
        if (error == null || error.isEmpty()) error = progress.getString("error");
        if (error != null && !error.isEmpty()) out.put("reason", error);
        return out;
    }

    /** Package-visible for local JVM policy tests. */
    static boolean safeRelative(String path) {
        return path != null && path.length() <= 180 && !path.isEmpty()
                && path.matches("^[A-Za-z0-9._/-]+$") && !path.startsWith("/")
                && !path.contains("..") && !path.contains("//");
    }

    private String shortHash(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 12; i++) out.append(String.format(Locale.US, "%02x", digest[i] & 255));
        return out.toString();
    }

    private String safeReason(Throwable error) {
        String message = error.getMessage();
        return (message == null || message.isEmpty() ? error.getClass().getSimpleName() : message)
                .replaceAll("[^A-Za-z0-9_.:-]", "_");
    }
}
