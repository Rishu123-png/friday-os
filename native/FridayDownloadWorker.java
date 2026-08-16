package com.rishu.fridayos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Data;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Persistent, resumable, foreground downloader for FRIDAY's large local models.
 *
 * WorkManager owns the job, so rotation, WebView teardown, backgrounding, and a
 * killed activity do not cancel it. Files are written only below filesDir,
 * resumed through .part files, validated, and atomically finalized.
 */
public final class FridayDownloadWorker extends Worker {
    public static final String CHANNEL = "friday_downloads";
    public static final String KEY_MODE = "mode";
    public static final String KEY_URL = "url";
    public static final String KEY_DEST = "dest";
    public static final String KEY_SHA256 = "sha256";
    public static final String KEY_EXPECTED = "expected_bytes";
    public static final String KEY_REPO = "repo";
    public static final String KEY_EXTRACT_ZIP = "extract_zip";
    public static final String KEY_STRIP_TOP_LEVEL = "strip_top_level";
    private static final long RESERVE_BYTES = 64L * 1024L * 1024L;
    private static final long META_LIMIT = 4L * 1024L * 1024L;
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_ATTEMPTS = 4;

    private static final class PermanentFailure extends Exception {
        PermanentFailure(String message) { super(message); }
    }

    private static final class RemoteFile {
        String path;
        long size;
        String sha256;
        RemoteFile(String path, long size, String sha256) {
            this.path = path; this.size = size; this.sha256 = sha256;
        }
    }

    public FridayDownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        createChannel();
        try { setForegroundAsync(foreground("Preparing download", 0)); } catch (Throwable ignored) {}
        try {
            String mode = getInputData().getString(KEY_MODE);
            if ("hf_repo".equals(mode)) return downloadHuggingFaceRepo();
            if ("url".equals(mode)) return downloadSingle();
            throw new PermanentFailure("unsupported_mode");
        } catch (PermanentFailure e) {
            return fail(e.getMessage());
        } catch (Throwable e) {
            String reason = safeReason(e);
            if (isStopped() || getRunAttemptCount() + 1 >= MAX_ATTEMPTS) return fail(reason);
            setProgressAsync(progress("retrying", 0, 0, 0, reason));
            return Result.retry();
        }
    }

    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        createChannel();
        return foreground("Downloading offline capability", 0);
    }

    private Result downloadSingle() throws Exception {
        String url = required(KEY_URL);
        String dest = required(KEY_DEST);
        File finalFile = safeDestination(getApplicationContext().getFilesDir(), dest);
        long expected = getInputData().getLong(KEY_EXPECTED, 0);
        String sha256 = cleanHash(getInputData().getString(KEY_SHA256));
        download(url, finalFile, expected, sha256, 0, 1);

        boolean extract = getInputData().getBoolean(KEY_EXTRACT_ZIP, false);
        String path = finalFile.getAbsolutePath();
        if (extract) {
            File out = new File(finalFile.getParentFile(), finalFile.getName() + "_extracted");
            File staging = new File(finalFile.getParentFile(), finalFile.getName() + "_extracting");
            deleteTree(staging);
            safeExtractZip(finalFile, staging, getInputData().getBoolean(KEY_STRIP_TOP_LEVEL, false));
            deleteTree(out);
            if (!staging.renameTo(out)) {
                deleteTree(staging);
                throw new PermanentFailure("cannot_finalize_extract");
            }
            path = out.getAbsolutePath();
        }
        return Result.success(new Data.Builder().putString("path", path).putString("state", "complete").build());
    }

    private Result downloadHuggingFaceRepo() throws Exception {
        String repo = required(KEY_REPO);
        String dest = required(KEY_DEST);
        if (!repo.matches("^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$"))
            throw new PermanentFailure("invalid_repo");
        if (!dest.matches("^[A-Za-z0-9._-]{1,100}$"))
            throw new PermanentFailure("invalid_destination");

        String api = "https://huggingface.co/api/models/" + Uri.encode(repo, "/") + "?blobs=true";
        byte[] metadata = readBounded(api, META_LIMIT);
        JSONObject root = new JSONObject(new String(metadata, StandardCharsets.UTF_8));
        JSONArray siblings = root.optJSONArray("siblings");
        if (siblings == null) throw new PermanentFailure("repo_has_no_files");

        ArrayList<RemoteFile> files = new ArrayList<>();
        for (int i = 0; i < siblings.length(); i++) {
            JSONObject item = siblings.optJSONObject(i);
            if (item == null) continue;
            String path = item.optString("rfilename", "");
            String base = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
            if (path.isEmpty() || ".gitattributes".equals(base)
                    || "readme.md".equalsIgnoreCase(base) || "license".equalsIgnoreCase(base)) continue;
            JSONObject lfs = item.optJSONObject("lfs");
            long size = lfs != null ? lfs.optLong("size", 0) : item.optLong("size", 0);
            String hash = lfs != null ? cleanHash(lfs.optString("sha256", "")) : "";
            files.add(new RemoteFile(path, size, hash));
        }
        if (files.isEmpty()) throw new PermanentFailure("repo_has_no_downloadable_files");

        File repoRoot = safeDestination(new File(getApplicationContext().getFilesDir(), "hfRepo"), dest);
        if (!repoRoot.exists() && !repoRoot.mkdirs()) throw new PermanentFailure("cannot_create_destination");
        for (int i = 0; i < files.size(); i++) {
            if (isStopped()) throw new PermanentFailure("cancelled");
            RemoteFile remote = files.get(i);
            File out = safeDestination(repoRoot, remote.path);
            String fileUrl = "https://huggingface.co/" + Uri.encode(repo, "/")
                    + "/resolve/main/" + encodePath(remote.path);
            download(fileUrl, out, remote.size, remote.sha256, i, files.size());
        }
        return Result.success(new Data.Builder()
                .putString("path", repoRoot.getAbsolutePath())
                .putInt("file_count", files.size()).putString("state", "complete").build());
    }

    private void download(String source, File target, long expected, String sha256,
                          int fileIndex, int fileCount) throws Exception {
        File parent = target.getParentFile();
        if (parent == null || (!parent.exists() && !parent.mkdirs()))
            throw new PermanentFailure("cannot_create_destination");
        File part = new File(target.getAbsolutePath() + ".part");

        if (target.isFile()) {
            if ((expected <= 0 || target.length() == expected)
                    && (sha256.isEmpty() || sha256.equalsIgnoreCase(hash(target)))) return;
            if (!target.delete()) throw new PermanentFailure("cannot_replace_invalid_file");
        }
        long offset = part.isFile() ? part.length() : 0;
        if (expected > 0 && offset > expected) {
            if (!part.delete()) throw new PermanentFailure("cannot_reset_invalid_partial");
            offset = 0;
        }
        // A process can die after fsync but before the atomic rename. Avoid a
        // doomed bytes=<length>- request: validate and publish the complete part.
        if (expected > 0 && offset == expected) {
            if (!sha256.isEmpty() && !sha256.equalsIgnoreCase(hash(part))) {
                if (!part.delete()) throw new PermanentFailure("cannot_reset_invalid_partial");
                throw new PermanentFailure("sha256_mismatch");
            }
            rejectHtmlMasquerade(part, target.getName());
            atomicMove(part, target);
            publish(target.getName(), 100, target.length(), target.length(), fileIndex, fileCount);
            return;
        }

        HttpURLConnection connection = open(source, offset);
        try {
            int code = connection.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL)
                throw new java.io.IOException("http_" + code);
            String contentRange = connection.getHeaderField("Content-Range");
            if (code == HttpURLConnection.HTTP_PARTIAL
                    && (offset <= 0 || !validContentRange(contentRange, offset, expected))) {
                throw new PermanentFailure("invalid_content_range");
            }
            boolean append = code == HttpURLConnection.HTTP_PARTIAL && offset > 0;
            if (!append) offset = 0;
            long responseBytes = connection.getContentLengthLong();
            long rangedTotal = append ? contentRangeTotal(contentRange) : 0;
            long total = expected > 0 ? expected
                    : (rangedTotal > 0 ? rangedTotal : (responseBytes > 0 ? offset + responseBytes : 0));
            ensureStorage(total > 0 ? Math.max(0, total - offset) : RESERVE_BYTES);

            try (InputStream in = new BufferedInputStream(connection.getInputStream(), 64 * 1024);
                 FileOutputStream fos = new FileOutputStream(part, append);
                 BufferedOutputStream out = new BufferedOutputStream(fos, 64 * 1024)) {
                byte[] buffer = new byte[64 * 1024];
                long done = offset;
                long lastUpdate = 0;
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (isStopped()) throw new PermanentFailure("cancelled");
                    out.write(buffer, 0, count);
                    done += count;
                    long now = System.currentTimeMillis();
                    if (now - lastUpdate >= 750) {
                        int pct = total > 0 ? (int) Math.min(99, done * 100 / total) : 0;
                        publish(target.getName(), pct, done, total, fileIndex, fileCount);
                        lastUpdate = now;
                    }
                }
                out.flush();
                fos.getFD().sync();
            }
        } finally {
            connection.disconnect();
        }

        if (expected > 0 && part.length() != expected)
            throw new java.io.IOException("size_mismatch");
        if (!sha256.isEmpty() && !sha256.equalsIgnoreCase(hash(part))) {
            part.delete();
            throw new PermanentFailure("sha256_mismatch");
        }
        rejectHtmlMasquerade(part, target.getName());
        atomicMove(part, target);
        publish(target.getName(), 100, target.length(), target.length(), fileIndex, fileCount);
    }

    private HttpURLConnection open(String source, long offset) throws Exception {
        URL current = new URL(source);
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            validatePublicHttps(current);
            HttpURLConnection c = (HttpURLConnection) current.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20_000);
            c.setReadTimeout(60_000);
            c.setRequestProperty("User-Agent", "FRIDAY-OS/1.3 Android");
            c.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) c.setRequestProperty("Range", "bytes=" + offset + "-");
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null || redirects == MAX_REDIRECTS)
                    throw new PermanentFailure("invalid_redirect");
                current = new URL(current, location);
                continue;
            }
            return c;
        }
        throw new PermanentFailure("too_many_redirects");
    }

    private static final Pattern CONTENT_RANGE = Pattern.compile(
            "^bytes\\s+(\\d+)-(\\d+)/(\\d+)$", Pattern.CASE_INSENSITIVE);

    /** Package-visible for JVM tests of resume integrity. */
    static boolean validContentRange(String value, long expectedStart, long expectedTotal) {
        if (value == null || expectedStart < 0) return false;
        Matcher match = CONTENT_RANGE.matcher(value.trim());
        if (!match.matches()) return false;
        try {
            long start = Long.parseLong(match.group(1));
            long end = Long.parseLong(match.group(2));
            long total = Long.parseLong(match.group(3));
            return start == expectedStart && end >= start && total > end
                    && (expectedTotal <= 0 || total == expectedTotal);
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static long contentRangeTotal(String value) {
        if (value == null) return 0;
        Matcher match = CONTENT_RANGE.matcher(value.trim());
        if (!match.matches()) return 0;
        try { return Long.parseLong(match.group(3)); }
        catch (NumberFormatException ignored) { return 0; }
    }

    private byte[] readBounded(String source, long limit) throws Exception {
        HttpURLConnection c = open(source, 0);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new java.io.IOException("http_" + code);
            if (c.getContentLengthLong() > limit) throw new PermanentFailure("metadata_too_large");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[16 * 1024]; int n;
                while ((n = in.read(buf)) != -1) {
                    if (out.size() + n > limit) throw new PermanentFailure("metadata_too_large");
                    out.write(buf, 0, n);
                }
            }
            return out.toByteArray();
        } finally { c.disconnect(); }
    }

    private void publish(String file, int percent, long bytes, long total,
                         int fileIndex, int fileCount) {
        int overall = fileCount <= 1 ? percent
                : (int) Math.min(99, ((fileIndex + percent / 100.0) / fileCount) * 100);
        setProgressAsync(progress(file, overall, bytes, total, ""));
        try { setForegroundAsync(foreground(file, overall)); } catch (Throwable ignored) {}
    }

    private Data progress(String file, int percent, long bytes, long total, String error) {
        return new Data.Builder().putString("file", file).putInt("percent", percent)
                .putLong("bytes", bytes).putLong("total_bytes", total)
                .putString("error", error == null ? "" : error).build();
    }

    private Result fail(String reason) {
        String clean = reason == null || reason.isEmpty() ? "download_failed" : reason;
        return Result.failure(new Data.Builder().putString("error", clean).putString("state", "failed").build());
    }

    private ForegroundInfo foreground(String text, int percent) {
        Context context = getApplicationContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) intent = new Intent();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(context, 8301, intent, flags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(com.rishu.fridayos.R.drawable.ic_stat_icon)
                .setContentTitle("FRIDAY offline download")
                .setContentText(text).setOnlyAlertOnce(true).setOngoing(true)
                .setContentIntent(pending).setProgress(100, Math.max(0, percent), percent <= 0);
        return new ForegroundInfo(8301, b.build());
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getApplicationContext()
                .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                    "Offline capability downloads", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Progress for user-requested FRIDAY model downloads");
            manager.createNotificationChannel(channel);
        }
    }

    private String required(String key) throws PermanentFailure {
        String value = getInputData().getString(key);
        if (value == null || value.trim().isEmpty()) throw new PermanentFailure("missing_" + key);
        return value.trim();
    }

    private File safeDestination(File root, String relative) throws Exception {
        if (relative == null || relative.isEmpty() || relative.indexOf('\0') >= 0)
            throw new PermanentFailure("invalid_destination");
        File canonicalRoot = root.getCanonicalFile();
        File candidate = new File(canonicalRoot, relative).getCanonicalFile();
        String prefix = canonicalRoot.getPath() + File.separator;
        if (!candidate.getPath().startsWith(prefix)) throw new PermanentFailure("unsafe_destination");
        return candidate;
    }

    private void ensureStorage(long remaining) throws PermanentFailure {
        StatFs stat = new StatFs(getApplicationContext().getFilesDir().getPath());
        if (stat.getAvailableBytes() < Math.max(remaining, 0) + RESERVE_BYTES)
            throw new PermanentFailure("insufficient_storage");
    }

    private void validatePublicHttps(URL url) throws Exception {
        if (!"https".equalsIgnoreCase(url.getProtocol()) || (url.getPort() != -1 && url.getPort() != 443))
            throw new PermanentFailure("https_required");
        if (url.getUserInfo() != null) throw new PermanentFailure("url_credentials_blocked");
        InetAddress[] addresses = InetAddress.getAllByName(url.getHost());
        if (addresses.length == 0) throw new PermanentFailure("host_unresolved");
        for (InetAddress address : addresses) if (!isPublic(address))
            throw new PermanentFailure("private_host_blocked");
    }

    private boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()) return false;
        byte[] b = address.getAddress();
        if (address instanceof Inet4Address) {
            int a = b[0] & 255, c = b[1] & 255, d = b[2] & 255;
            if (a == 0 || a == 10 || a == 127 || a >= 224) return false;
            if (a == 100 && c >= 64 && c <= 127) return false;
            if (a == 169 && c == 254) return false;
            if (a == 172 && c >= 16 && c <= 31) return false;
            if (a == 192 && (c == 168 || (c == 0 && (d == 0 || d == 2)))) return false;
            if (a == 198 && (c == 18 || c == 19 || (c == 51 && d == 100))) return false;
            if (a == 203 && c == 0 && d == 113) return false;
        } else if (address instanceof Inet6Address) {
            if ((b[0] & 0xfe) == 0xfc) return false;
            if ((b[0] & 255) == 0x20 && (b[1] & 255) == 0x01
                    && (b[2] & 255) == 0x0d && (b[3] & 255) == 0xb8) return false;
        }
        return true;
    }

    private String cleanHash(String hash) throws PermanentFailure {
        if (hash == null || hash.trim().isEmpty()) return "";
        String value = hash.trim().toLowerCase(Locale.US);
        if (!value.matches("^[0-9a-f]{64}$")) throw new PermanentFailure("invalid_sha256");
        return value;
    }

    private String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[1024 * 1024]; int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        StringBuilder out = new StringBuilder(64);
        for (byte b : digest.digest()) out.append(String.format(Locale.US, "%02x", b & 255));
        return out.toString();
    }

    private void rejectHtmlMasquerade(File file, String name) throws Exception {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".txt")
                || lower.endsWith(".json") || lower.endsWith(".md")) return;
        byte[] first = new byte[(int) Math.min(256, file.length())];
        try (InputStream in = new FileInputStream(file)) { int ignored = in.read(first); }
        String head = new String(first, StandardCharsets.UTF_8).trim().toLowerCase(Locale.US);
        if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
            file.delete();
            throw new PermanentFailure("unexpected_html_response");
        }
    }

    private void atomicMove(File source, File target) throws Exception {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
                return;
            } catch (AtomicMoveNotSupportedException ignored) {}
        }
        if (target.exists() && !target.delete()) throw new PermanentFailure("cannot_replace_target");
        if (!source.renameTo(target)) throw new PermanentFailure("finalize_failed");
    }

    /** Zip-slip, zip-bomb and traversal-safe extractor for optional model packs. */
    private void safeExtractZip(File zip, File destination, boolean stripTopLevel) throws Exception {
        long maxExpanded = Math.max(512L * 1024L * 1024L, zip.length() * 20L);
        ensureStorage(Math.min(maxExpanded, Math.max(128L * 1024L * 1024L, zip.length() * 3L)));
        extractZip(zip, destination, stripTopLevel, maxExpanded);
    }

    /** Package-visible pure-Java extraction core so the security policy is JVM-testable. */
    static void extractZip(File zip, File destination, boolean stripTopLevel,
                           long maxExpanded) throws Exception {
        if (maxExpanded <= 0) throw new PermanentFailure("invalid_zip_expansion_limit");
        File root = destination.getCanonicalFile();
        if (!root.exists() && !root.mkdirs()) throw new PermanentFailure("cannot_create_extract_dir");
        long expanded = 0; int entries = 0;
        Set<String> seen = new HashSet<>();
        String strippedRoot = null;
        try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry entry;
            byte[] buffer = new byte[64 * 1024];
            while ((entry = zin.getNextEntry()) != null) {
                if (++entries > 10_000) throw new PermanentFailure("zip_too_many_entries");
                String entryName = entry.getName().replace('\\', '/');
                if (entryName.isEmpty() || entryName.startsWith("/") || entryName.indexOf('\0') >= 0) {
                    throw new PermanentFailure("unsafe_zip_entry");
                }
                if (stripTopLevel) {
                    int slash = entryName.indexOf('/');
                    if (slash <= 0) throw new PermanentFailure("zip_missing_single_top_level_dir");
                    String candidateRoot = entryName.substring(0, slash);
                    if (candidateRoot.equals(".") || candidateRoot.equals("..")) {
                        throw new PermanentFailure("unsafe_zip_entry");
                    }
                    if (strippedRoot == null) strippedRoot = candidateRoot;
                    else if (!strippedRoot.equals(candidateRoot)) {
                        throw new PermanentFailure("zip_multiple_top_level_entries");
                    }
                    if (slash + 1 >= entryName.length()) { zin.closeEntry(); continue; }
                    entryName = entryName.substring(slash + 1);
                }
                File out = new File(root, entryName).getCanonicalFile();
                if (!out.getPath().startsWith(root.getPath() + File.separator)
                        || !seen.add(out.getPath())) throw new PermanentFailure("unsafe_zip_entry");
                if (entry.isDirectory()) { if (!out.exists() && !out.mkdirs()) throw new PermanentFailure("zip_mkdir_failed"); continue; }
                File parent = out.getParentFile();
                if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new PermanentFailure("zip_mkdir_failed");
                try (FileOutputStream fileOut = new FileOutputStream(out)) {
                    int n; while ((n = zin.read(buffer)) != -1) {
                        expanded += n;
                        if (expanded > maxExpanded) throw new PermanentFailure("zip_expansion_limit");
                        fileOut.write(buffer, 0, n);
                    }
                    fileOut.getFD().sync();
                }
            }
            if (entries == 0 || expanded == 0 || (stripTopLevel && strippedRoot == null)) {
                throw new PermanentFailure("empty_zip");
            }
        } catch (Exception error) {
            deleteTree(root);
            throw error;
        }
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    private String encodePath(String path) {
        String[] parts = path.split("/");
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (out.length() > 0) out.append('/');
            out.append(Uri.encode(part));
        }
        return out.toString();
    }

    private String safeReason(Throwable error) {
        String name = error.getClass().getSimpleName();
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return name;
        return (name + ":" + message).replaceAll("[^A-Za-z0-9_.:-]", "_").substring(0,
                Math.min(180, (name + ":" + message).length()));
    }
}
