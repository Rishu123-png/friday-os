package com.rishu.fridayos;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

/** Trusted actions from FRIDAY's companion notification. Never sends replies itself. */
public class FridayAssistantActionReceiver extends BroadcastReceiver {
    public static final String ACTION_READ = "com.rishu.fridayos.ASSISTANT_READ";
    public static final String ACTION_OPEN = "com.rishu.fridayos.ASSISTANT_OPEN";
    public static final String ACTION_REPLY = "com.rishu.fridayos.ASSISTANT_REPLY";
    public static final String ACTION_IGNORE = "com.rishu.fridayos.ASSISTANT_IGNORE";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String pkg = safe(intent.getStringExtra("pkg"));
        String title = safe(intent.getStringExtra("title"));
        String text = safe(intent.getStringExtra("text"));
        String key = safe(intent.getStringExtra("eventKey"));
        boolean sensitive = intent.getBooleanExtra("sensitive", false)
                || FridayAssistantPolicy.isSensitive(pkg, title, text);
        int notificationId = intent.getIntExtra("notificationId", 0);
        if (ACTION_READ.equals(action)) {
            if (sensitive) {
                FridayAssistantSpeech.speak(context,
                        "Boss, that is a sensitive notification. Open it on your phone to review it securely.", true);
            } else if (!FridayAssistantSpeech.canReveal(context)) {
                FridayAssistantSpeech.speak(context,
                        "Boss, that notification is private. Unlock your phone or use headphones before I read it.", true);
            } else {
                FridayAssistantSpeech.speak(context,
                        (title.isEmpty() ? "Notification" : title) + ". " + FridayAssistantPolicy.safeText(text, 400), true);
            }
        } else if (ACTION_REPLY.equals(action)) {
            savePending(context, key, pkg, title, text, sensitive);
            launchPackage(context, context.getPackageName(), true);
        } else if (ACTION_OPEN.equals(action)) {
            launchPackage(context, pkg, false);
        } else if (ACTION_IGNORE.equals(action)) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && notificationId != 0) nm.cancel(notificationId);
        }
    }

    public static PendingIntent pending(Context context, String action, int requestCode, int notificationId,
                                        String eventKey, String pkg, String title, String text,
                                        boolean sensitive) {
        Intent i = new Intent(context, FridayAssistantActionReceiver.class).setAction(action)
                .setData(Uri.parse("friday://assistant-action/" + Uri.encode(action)
                        + "/" + Uri.encode(eventKey)))
                .putExtra("notificationId", notificationId).putExtra("eventKey", eventKey)
                .putExtra("pkg", pkg).putExtra("sensitive", sensitive)
                .putExtra("title", sensitive ? "Private notification" : title)
                .putExtra("text", sensitive ? "" : text);
        return PendingIntent.getBroadcast(context, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void savePending(Context context, String key, String pkg, String title, String text) {
        savePending(context, key, pkg, title, text,
                FridayAssistantPolicy.isSensitive(pkg, title, text));
    }

    public static void savePending(Context context, String key, String pkg, String title, String text,
                                   boolean sensitive) {
        try {
            JSONObject event = new JSONObject();
            event.put("key", key); event.put("pkg", pkg);
            event.put("title", sensitive ? "Private notification" : title);
            event.put("text", sensitive ? "" : text);
            event.put("sensitive", sensitive);
            event.put("at", System.currentTimeMillis());
            context.getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE).edit()
                    .putString("pending_event", event.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static void launchPackage(Context context, String pkg, boolean singleTop) {
        try {
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(pkg);
            if (launch == null) return;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (singleTop) launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(launch);
        } catch (Exception ignored) {}
    }

    private static String safe(String s) { return s == null ? "" : s; }
}
