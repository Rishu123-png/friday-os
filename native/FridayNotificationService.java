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

    /* ---- reply-target registry: package -> what's needed to answer ---- */
    private static final Map<String, ReplyTarget> REPLIES = new HashMap<>();
    private static String lastReplyApp = "";

    private static class ReplyTarget {
        PendingIntent intent;   // the action's PendingIntent
        String remoteKey;       // RemoteInput result key ("key_text_reply" etc.)
        long when;
    }

    public static void setPlugin(FridayNative p) { plugin = p; }

    @Override
    public void onListenerConnected() { connected = true; }

    @Override
    public void onListenerDisconnected() { connected = false; }

    public static boolean isEnabled() { return connected; }

    /** 1 = sent, 2 = reply action refused/expired, 0 = nothing replyable found */
    public static int reply(Context ctx, String app, String text) {
        try {
            ReplyTarget t = null;
            String usedApp = "";

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

            Bundle results = new Bundle();
            results.putCharSequence(t.remoteKey, text);
            Intent fill = new Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            RemoteInput.addResultsToIntent(
                    new RemoteInput[]{ new RemoteInput.Builder(t.remoteKey).build() },
                    fill, results);

            t.intent.send(ctx, 0, fill);
            REPLIES.remove(usedApp);
            if (usedApp.equals(lastReplyApp)) lastReplyApp = "";
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
                REPLIES.put(pkg, t);
                lastReplyApp = pkg;
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
