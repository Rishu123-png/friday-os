package com.rishu.fridayos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Notification listener with smart classification, privacy policy and action-bound replies. */
public class FridayNotificationService extends NotificationListenerService {
    private static final int LOG_CAP = 80;
    private static final String ASSISTANT_CHANNEL = "friday_assistant_events";
    private static volatile FridayNotificationService instance;
    private static volatile FridayNative plugin;
    private static final Map<String, ReplyTarget> REPLIES = new ConcurrentHashMap<>();
    private static final Map<String, String> LATEST_BY_PACKAGE = new ConcurrentHashMap<>();
    private static final Map<String, Long> DEDUPE = new ConcurrentHashMap<>();
    private static final ArrayDeque<Long> RATE = new ArrayDeque<>();

    static final class ReplyTarget {
        final String eventKey;
        final String pkg;
        final String recipient;
        final PendingIntent intent;
        final RemoteInput[] inputs;
        ReplyTarget(String eventKey, String pkg, String recipient, PendingIntent intent, RemoteInput[] inputs) {
            this.eventKey = eventKey; this.pkg = pkg; this.recipient = recipient;
            this.intent = intent; this.inputs = inputs;
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        REPLIES.clear();
        LATEST_BY_PACKAGE.clear();
        instance = this;
        scrubSensitiveLog();
    }

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        /* Rebuild capabilities from Android's current live set without replaying
           announcements or trusting targets retained by an earlier service. */
        REPLIES.clear();
        LATEST_BY_PACKAGE.clear();
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active == null) return;
            for (StatusBarNotification sbn : active) {
                if (sbn == null || getPackageName().equals(sbn.getPackageName())) continue;
                Notification n = sbn.getNotification();
                Bundle extras = n.extras;
                String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
                String body = text(extras.getCharSequence(Notification.EXTRA_TEXT));
                if (body.isEmpty()) body = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
                if (!FridayAssistantPolicy.isSensitive(sbn.getPackageName(), title, body)) {
                    captureReply(sbn.getKey(), sbn.getPackageName(), title, n);
                }
            }
        } catch (Exception ignored) {
            REPLIES.clear();
            LATEST_BY_PACKAGE.clear();
        }
    }

    @Override public void onDestroy() {
        if (instance == this) {
            instance = null;
            REPLIES.clear();
            LATEST_BY_PACKAGE.clear();
        }
        super.onDestroy();
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getPackageName().equals(getPackageName())) return;
        Notification n = sbn.getNotification();
        Bundle e = n.extras;
        String pkg = sbn.getPackageName();
        String key = sbn.getKey();
        String title = text(e.getCharSequence(Notification.EXTRA_TITLE));
        String body = text(e.getCharSequence(Notification.EXTRA_TEXT));
        if (body.isEmpty()) body = text(e.getCharSequence(Notification.EXTRA_BIG_TEXT));
        /* A notification update can remove or replace RemoteInput while keeping
           the same key. Drop the old capability before inspecting this version. */
        REPLIES.remove(key);
        LATEST_BY_PACKAGE.remove(pkg, key);
        boolean replyable = captureReply(key, pkg, title, n);
        FridayAssistantPolicy.Category category = FridayAssistantPolicy.classify(pkg, title, body);
        boolean sensitive = FridayAssistantPolicy.isSensitive(pkg, title, body);
        if (sensitive && replyable) {
            /* Never turn OTP/banking notifications into outbound reply capabilities. */
            REPLIES.remove(key);
            LATEST_BY_PACKAGE.remove(pkg, key);
            replyable = false;
        }
        int importance = rankingImportance(sbn);
        appendLog(key, pkg, title, body, category.name(), sensitive, replyable, sbn.getPostTime());
        boolean announced = shouldAnnounce(pkg, title, body, category, importance);
        FridayNative target = plugin;
        if (target != null) target.emitNotification(key, pkg,
                sensitive ? "Private notification" : title, sensitive ? "" : body,
                category.name(), sensitive, replyable, announced);
        if (!announced) return;

        String app = appLabel(pkg);
        boolean reveal = !sensitive && FridayAssistantSpeech.canReveal(this);
        SharedPreferences prefs = getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE);
        String address = prefs.getString("address", "Boss");
        String prompt = FridayAssistantPolicy.prompt(address, category, app, title, reveal);
        FridayAssistantActionReceiver.savePending(this, key, pkg, title, body, sensitive);
        showAssistantNotification(key, pkg, app, title, body, category, sensitive, replyable, prompt);
        FridayAssistantSpeech.speak(this, prompt, false);
    }

    @Override public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn == null) return;
        REPLIES.remove(sbn.getKey());
        String latest = LATEST_BY_PACKAGE.get(sbn.getPackageName());
        if (sbn.getKey().equals(latest)) LATEST_BY_PACKAGE.remove(sbn.getPackageName());
    }

    private boolean captureReply(String eventKey, String pkg, String recipient, Notification n) {
        if (n.actions == null) return false;
        for (Notification.Action a : n.actions) {
            RemoteInput[] inputs = a.getRemoteInputs();
            if (inputs == null || inputs.length == 0 || a.actionIntent == null) continue;
            List<RemoteInput> freeForm = new ArrayList<>();
            for (RemoteInput input : inputs) {
                if (input != null && input.getAllowFreeFormInput()) freeForm.add(input);
            }
            if (freeForm.isEmpty()) continue;
            RemoteInput[] writable = freeForm.toArray(new RemoteInput[0]);
            REPLIES.put(eventKey,
                    new ReplyTarget(eventKey, pkg, cleanIdentity(recipient), a.actionIntent, writable));
            LATEST_BY_PACKAGE.put(pkg, eventKey);
            return true;
        }
        return false;
    }

    private boolean shouldAnnounce(String pkg, String title, String body,
                                   FridayAssistantPolicy.Category category, int importance) {
        SharedPreferences p = getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("proactive_enabled", false) || !p.getBoolean("notifications_enabled", true)) return false;
        if (p.getBoolean("private_mode", false)) return false;
        if (FridayAssistantSpeech.isQuietNow(p)) return false;
        if (!FridayAssistantPolicy.isWorthInterrupting(category, importance)) return false;
        String categories = "," + p.getString("categories", "MESSAGE,EMAIL,CALENDAR,DELIVERY,MISSED_CALL,SENSITIVE") + ",";
        if (!categories.contains("," + category.name() + ",")) return false;
        if (csvContains(p.getString("blocked_packages", ""), pkg)) return false;
        if (csvContains(p.getString("blocked_contacts", ""), title)) return false;
        long now = System.currentTimeMillis();
        String key = FridayAssistantPolicy.dedupeKey(pkg, title, body);
        String durableKey = Integer.toHexString(key.hashCode());
        JSONObject durableDedupe;
        try { durableDedupe = new JSONObject(p.getString("dedupe_events", "{}")); }
        catch (Exception ignored) { durableDedupe = new JSONObject(); }
        Long seen = DEDUPE.get(key);
        long durableSeen = durableDedupe.optLong(durableKey, 0L);
        if ((seen != null && now - seen < 120_000L)
                || (durableSeen > 0L && now - durableSeen < 120_000L)) return false;

        String updatedRates;
        synchronized (RATE) {
            /* Hydrate every decision from private durable state so a process restart
               cannot reset the configured hourly cap or minimum gap. */
            RATE.clear();
            try {
                JSONArray stored = new JSONArray(p.getString("rate_events", "[]"));
                for (int i = 0; i < stored.length(); i++) {
                    long at = stored.optLong(i, 0L);
                    if (at > 0L && now - at <= 3_600_000L) RATE.addLast(at);
                }
            } catch (Exception ignored) {}
            int max = Math.max(1, Math.min(60, p.getInt("max_per_hour", 12)));
            if (RATE.size() >= max) return false;
            long minGap = Math.max(5, p.getInt("rate_limit_seconds", 20)) * 1000L;
            if (!RATE.isEmpty() && now - RATE.peekLast() < minGap) return false;
            RATE.addLast(now);
            JSONArray updated = new JSONArray();
            for (Long at : RATE) updated.put(at);
            updatedRates = updated.toString();
        }

        try {
            JSONObject kept = new JSONObject();
            for (java.util.Iterator<String> it = durableDedupe.keys(); it.hasNext();) {
                String candidate = it.next();
                long at = durableDedupe.optLong(candidate, 0L);
                if (at > 0L && now - at <= 3_600_000L) kept.put(candidate, at);
            }
            kept.put(durableKey, now);
            boolean persisted = p.edit()
                    .putString("rate_events", updatedRates)
                    .putString("dedupe_events", kept.toString())
                    .commit();
            if (!persisted) return false;
        } catch (Exception ignored) { return false; }
        DEDUPE.put(key, now);
        if (DEDUPE.size() > 160) {
            for (Map.Entry<String, Long> entry : new HashMap<>(DEDUPE).entrySet()) {
                if (now - entry.getValue() > 3_600_000L) DEDUPE.remove(entry.getKey());
            }
        }
        return true;
    }

    private int rankingImportance(StatusBarNotification sbn) {
        if (Build.VERSION.SDK_INT >= 24) {
            Ranking ranking = new Ranking();
            if (getCurrentRanking().getRanking(sbn.getKey(), ranking)) return ranking.getImportance();
        }
        return Math.max(1, Math.min(5, sbn.getNotification().priority + 3));
    }

    private void showAssistantNotification(String eventKey, String pkg, String app, String title, String body,
                                           FridayAssistantPolicy.Category category, boolean sensitive,
                                           boolean replyable, String prompt) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(ASSISTANT_CHANNEL,
                    "FRIDAY proactive prompts", NotificationManager.IMPORTANCE_HIGH);
            c.setDescription("Smart notification prompts with privacy-aware actions");
            nm.createNotificationChannel(c);
        }
        int id = 0x47000000 | (eventKey.hashCode() & 0x00ffffff);
        PendingIntent read = FridayAssistantActionReceiver.pending(this,
                FridayAssistantActionReceiver.ACTION_READ, id + 1, id, eventKey, pkg, title, body, sensitive);
        PendingIntent open = FridayAssistantActionReceiver.pending(this,
                FridayAssistantActionReceiver.ACTION_OPEN, id + 2, id, eventKey, pkg, title, body, sensitive);
        PendingIntent reply = FridayAssistantActionReceiver.pending(this,
                FridayAssistantActionReceiver.ACTION_REPLY, id + 3, id, eventKey, pkg, title, body, sensitive);
        PendingIntent later = FridayAssistantActionReceiver.pending(this,
                FridayAssistantActionReceiver.ACTION_IGNORE, id + 4, id, eventKey, pkg, title, body, sensitive);
        boolean revealNow = !sensitive && FridayAssistantSpeech.canReveal(this);
        String visible = !revealNow
                ? "Private " + category.name().toLowerCase().replace('_', ' ') + " update"
                : FridayAssistantPolicy.safeText(title.isEmpty() ? app : title, 90);
        String visibleTitle = revealNow ? "FRIDAY · " + app : "FRIDAY · Private update";
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, ASSISTANT_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(visibleTitle)
                .setContentText(visible).setStyle(new NotificationCompat.BigTextStyle().bigText(prompt))
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(open)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .addAction(android.R.drawable.ic_menu_view, "Read", read)
                .addAction(android.R.drawable.ic_menu_edit,
                        replyable ? "Reply in FRIDAY" : "Open", replyable ? reply : open)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Later", later);
        NotificationCompat.Builder publicVersion = new NotificationCompat.Builder(this, ASSISTANT_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("FRIDAY · Private update")
                .setContentText("Unlock to view or act on this notification")
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        b.setPublicVersion(publicVersion.build());
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) {}
    }

    private String appLabel(String pkg) {
        try { return getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); }
        catch (Exception ignored) { return pkg; }
    }

    private void appendLog(String key, String pkg, String title, String body, String category,
                           boolean sensitive, boolean replyable, long when) {
        try {
            JSONArray arr = readLog();
            JSONObject o = new JSONObject();
            o.put("key", key); o.put("pkg", pkg);
            /* OTP/banking bodies are not useful for drafting and must not remain in
               FRIDAY's inbox history. The source package is enough to open safely. */
            o.put("title", sensitive ? "Private notification" : title);
            o.put("text", sensitive ? "" : body);
            o.put("category", category); o.put("sensitive", sensitive); o.put("replyable", replyable); o.put("when", when);
            JSONArray next = new JSONArray();
            next.put(o);
            for (int i = 0; i < arr.length() && i < LOG_CAP - 1; i++) next.put(arr.get(i));
            getSharedPreferences("friday_notifications", MODE_PRIVATE).edit().putString("log", next.toString()).apply();
        } catch (Exception ignored) {}
    }

    private JSONArray readLog() {
        try {
            String raw = getSharedPreferences("friday_notifications", MODE_PRIVATE).getString("log", "[]");
            return new JSONArray(raw);
        } catch (Exception ignored) { return new JSONArray(); }
    }

    /** Remove sensitive bodies that may exist from a previous app version. */
    private void scrubSensitiveLog() {
        try {
            JSONArray src = readLog();
            boolean changed = false;
            for (int i = 0; i < src.length(); i++) {
                JSONObject item = src.optJSONObject(i);
                if (item != null && item.optBoolean("sensitive", false)) {
                    item.put("title", "Private notification");
                    item.put("text", "");
                    item.put("replyable", false);
                    changed = true;
                }
            }
            if (changed) getSharedPreferences("friday_notifications", MODE_PRIVATE)
                    .edit().putString("log", src.toString()).commit();
        } catch (Exception ignored) {}
    }

    public static JSONArray log(Context ctx, int limit) {
        return readLog(ctx, "", limit);
    }

    public static JSONArray readLog(Context ctx, String app, int limit) {
        try {
            JSONArray src = new JSONArray(ctx.getSharedPreferences("friday_notifications", MODE_PRIVATE).getString("log", "[]"));
            JSONArray out = new JSONArray();
            String needle = app == null ? "" : app.trim().toLowerCase();
            for (int i = 0; i < src.length() && out.length() < Math.max(1, Math.min(limit, LOG_CAP)); i++) {
                JSONObject item = src.optJSONObject(i);
                if (item == null) continue;
                if (item.optBoolean("sensitive", false)) {
                    item.put("title", "Private notification");
                    item.put("text", "");
                    item.put("replyable", false);
                }
                String pkg = item.optString("pkg", "").toLowerCase();
                if (needle.isEmpty() || pkg.contains(needle) || needle.contains(pkg)) out.put(item);
            }
            return out;
        } catch (Exception ignored) { return new JSONArray(); }
    }

    public static void setPlugin(FridayNative value) { plugin = value; }
    public static boolean isEnabled() { return instance != null; }
    public static StatusBarNotification[] active() {
        FridayNotificationService current = instance;
        if (current == null) return new StatusBarNotification[0];
        try { return current.getActiveNotifications(); }
        catch (Exception ignored) { return new StatusBarNotification[0]; }
    }

    /** Exact live RemoteInput identity used by the native one-use authorization gate. */
    public static boolean matchesReplyTarget(String eventKey, String pkg, String recipient) {
        if (eventKey == null || pkg == null || recipient == null) return false;
        ReplyTarget target = REPLIES.get(eventKey.trim());
        return target != null && target.pkg.equals(pkg.trim())
                && target.recipient.equals(cleanIdentity(recipient));
    }

    private static String cleanIdentity(String value) {
        if (value == null) return "";
        String cleaned = value.replaceAll("[\\p{Cntrl}]+", " ").replaceAll("\\s+", " ").trim();
        return cleaned.length() > 160 ? cleaned.substring(0, 160) : cleaned;
    }

    public static boolean reply(Context ctx, String eventKey, String app, String message) throws Exception {
        if (message == null || message.trim().isEmpty()) return false;
        boolean hasExactKey = eventKey != null && !eventKey.trim().isEmpty();
        if (!hasExactKey) return false;
        ReplyTarget target = REPLIES.get(eventKey.trim());
        if (target == null) return false;
        if (app == null || !target.pkg.equals(app.trim())) return false;
        Intent fill = new Intent();
        Bundle results = new Bundle();
        for (RemoteInput input : target.inputs) results.putCharSequence(input.getResultKey(), message.trim());
        RemoteInput.addResultsToIntent(target.inputs, fill, results);
        target.intent.send(ctx, 0, fill);
        return true;
    }

    public static boolean reply(Context ctx, String app, String message) throws Exception {
        return reply(ctx, "", app, message);
    }

    public static List<String> replyApps() {
        return new ArrayList<>(LATEST_BY_PACKAGE.keySet());
    }

    private static boolean csvContains(String csv, String value) {
        if (value == null || value.trim().isEmpty()) return false;
        String needle = value.trim();
        for (String entry : (csv == null ? "" : csv).split(",")) {
            if (entry.trim().equalsIgnoreCase(needle)) return true;
        }
        return false;
    }

    private static String text(CharSequence value) { return value == null ? "" : value.toString().trim(); }
}
