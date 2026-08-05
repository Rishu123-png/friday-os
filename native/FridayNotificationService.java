package com.rishu.fridayos;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.HashMap;
import java.util.Map;

/** Reads notifications from every app and forwards them to the WebView.
 *  User must enable FRIDAY under Settings > Notification access.
 *
 *  v2: also captures notifications that offer a REPLY action (RemoteInput),
 *  so "reply I'm on my way in whatsapp" actually answers the real
 *  notification - the same way Wear OS / Android Auto quick replies work.
 */
public class FridayNotificationService extends NotificationListenerService {

    private static FridayNative plugin;
    private static long lastEmit = 0;
    private static String lastKey = "";
    private static boolean connected = false;
    private static FridayNotificationService instance;

    /* ---- reply-target registry: package -> what's needed to answer ---- */
    /* v11.0.1 AUDIT-PART3 fix (RACE): this map is written on the notification-
       listener thread (captureReplyAction) and read/removed on the Capacitor
       bridge thread (replyNotification) — plain HashMap can corrupt/kill. */
    private static final Map<String, ReplyTarget> REPLIES = java.util.Collections.synchronizedMap(new HashMap<>());
    private static String lastReplyApp = "";

    private static class ReplyTarget {
        PendingIntent intent;   // the action's PendingIntent
        String remoteKey;       // RemoteInput result key ("key_text_reply" etc.)
        long when;
    }

    /* ---- v9.0 notification history ring (deleted-message keeper) ----
       Every posted notification's text is kept locally so history and the
       "what did they delete?" question still work after the sender unsends.
       Local SharedPreferences only - never leaves the phone. */
    private static final String PREFS = "friday_notif_log";
    private static final int LOG_MAX = 300;

    public static synchronized void appendLog(Context ctx, String pkg, String title, String text) {
        try {
            if ((title == null || title.isEmpty()) && (text == null || text.isEmpty())) return;
            android.content.SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            org.json.JSONArray arr;
            try { arr = new org.json.JSONArray(sp.getString("items", "[]")); }
            catch (Exception e) { arr = new org.json.JSONArray(); }
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("pkg", pkg);
            o.put("title", title == null ? "" : (title.length() > 120 ? title.substring(0, 120) : title));
            o.put("text", text == null ? "" : (text.length() > 240 ? text.substring(0, 240) : text));
            o.put("when", System.currentTimeMillis());
            arr.put(o);
            while (arr.length() > LOG_MAX) arr.remove(0);
            sp.edit().putString("items", arr.toString()).apply();
        } catch (Throwable ignored) {}
    }

    public static org.json.JSONArray readLog(Context ctx, String pkgFilter, int limit) {
        org.json.JSONArray out = new org.json.JSONArray();
        try {
            android.content.SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            org.json.JSONArray arr = new org.json.JSONArray(sp.getString("items", "[]"));
            String q = pkgFilter == null ? "" : pkgFilter.toLowerCase(java.util.Locale.ROOT);
            int n = 0;
            for (int i = arr.length() - 1; i >= 0 && n < limit; i--) {
                org.json.JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                if (!q.isEmpty() && !o.optString("pkg", "").toLowerCase(java.util.Locale.ROOT).contains(q)) continue;
                out.put(o); n++;
            }
        } catch (Throwable ignored) {}
        return out;
    }

    public static void setPlugin(FridayNative p) { plugin = p; }

    @Override
    public void onListenerConnected() { connected = true; instance = this; }

    @Override
    public void onListenerDisconnected() { connected = false; instance = null; }

    public static boolean isEnabled() { return connected; }

    /** Snapshot of what is sitting in the notification shade RIGHT NOW.
     *  Safe to call anytime - empty array when the listener is off. */
    public static StatusBarNotification[] active() {
        try {
            FridayNotificationService s = instance;
            if (s == null) return new StatusBarNotification[0];
            StatusBarNotification[] a = s.getActiveNotifications();
            return a == null ? new StatusBarNotification[0] : a;
        } catch (Throwable t) {
            return new StatusBarNotification[0];
        }
    }

    /** 1 = sent, 2 = reply action refused/expired, 0 = nothing replyable found */
    public static int reply(Context ctx, String app, String text) {
        try {
            ReplyTarget t;
            String usedApp;
            synchronized (FridayNotificationService.class) {   // v11.0.1 race fix (map iteration must be atomic)
                t = null;
                usedApp = "";
                if (app != null && !app.isEmpty()) {
                    String q = app.toLowerCase();
                    for (Map.Entry<String, ReplyTarget> e : REPLIES.entrySet()) {
                        if (e.getKey().toLowerCase().contains(q)) {
                            t = e.getValue();
                            usedApp = e.getKey();
                            break;
                        }
                    }
                }
                if (t == null && !lastReplyApp.isEmpty()) {
                    t = REPLIES.get(lastReplyApp);
                    usedApp = lastReplyApp;
                }
                if (t == null || t.intent == null) return 0;
                REPLIES.remove(usedApp);
                if (usedApp.equals(lastReplyApp)) lastReplyApp = "";
            }

            Bundle results = new Bundle();
            results.putCharSequence(t.remoteKey, text);
            Intent fill = new Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            RemoteInput.addResultsToIntent(
                    new RemoteInput[]{ new RemoteInput.Builder(t.remoteKey).build() },
                    fill, results);

            t.intent.send(ctx, 0, fill);
            return 1;
        } catch (PendingIntent.CanceledException e) {
            return 2;    // notification was dismissed already
        } catch (Exception e) {
            return 2;
        }
    }

    private void captureReplyAction(String pkg, Notification n) {
        try {
            if (n.actions == null) return;
            for (Notification.Action a : n.actions) {
                if (a == null || a.actionIntent == null) continue;
                RemoteInput[] ris = a.getRemoteInputs();
                if (ris == null || ris.length == 0 || ris[0] == null) continue;
                String key = ris[0].getResultKey();
                if (key == null || key.isEmpty()) continue;
                ReplyTarget t = new ReplyTarget();
                t.intent = a.actionIntent;
                t.remoteKey = key;
                t.when = System.currentTimeMillis();
                synchronized (FridayNotificationService.class) {   // v11.0.1 race fix
                    REPLIES.put(pkg, t);
                    lastReplyApp = pkg;
                }
                return;   // one reply action per notification is enough
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null) return;

            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.equals(getPackageName())) return;   // ignore our own

            Notification n = sbn.getNotification();
            if (n == null) return;
            // skip ongoing/silent system notifications
            if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

            captureReplyAction(pkg, n);   // v2: remember how to answer this

            /* v9.0: local history ring - written BEFORE any plugin check, so
               history keeps working in the background. Powers the deleted-
               message keeper and the notifications digest. Local only. */
            Bundle ex0 = n.extras;
            if (ex0 != null) {
                CharSequence t0 = ex0.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence x0 = ex0.getCharSequence(Notification.EXTRA_TEXT);
                appendLog(getApplicationContext(), pkg,
                        t0 == null ? "" : t0.toString(),
                        x0 == null ? "" : x0.toString());
            }

            if (plugin == null) return;
            Bundle ex = n.extras;
            if (ex == null) return;
            CharSequence t = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence x = ex.getCharSequence(Notification.EXTRA_TEXT);
            String title = t == null ? "" : t.toString();
            String text  = x == null ? "" : x.toString();
            if (title.isEmpty() && text.isEmpty()) return;

            // de-duplicate: same content within 4 seconds
            String key = pkg + "|" + title + "|" + text;
            long now = System.currentTimeMillis();
            if (key.equals(lastKey) && now - lastEmit < 4000) return;
            lastKey = key; lastEmit = now;

            plugin.emitNotification(pkg, title, text);
        } catch (Exception ignored) {}
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) { }
}
