package com.rishu.fridayos;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Reads notifications from every app and forwards them to the WebView.
 *  User must enable FRIDAY under Settings > Notification access. */
public class FridayNotificationService extends NotificationListenerService {

    private static FridayNative plugin;
    private static long lastEmit = 0;
    private static String lastKey = "";

    public static void setPlugin(FridayNative p) { plugin = p; }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (plugin == null || sbn == null) return;

            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.equals(getPackageName())) return;   // ignore our own

            Notification n = sbn.getNotification();
            if (n == null) return;
            // skip ongoing/silent system notifications
            if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

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
