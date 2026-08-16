package com.rishu.fridayos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/** Alarm/action receiver for reminders that remains functional without a WebView. */
public class FridayReminderReceiver extends BroadcastReceiver {
    public static final String ACTION_FIRE = "com.rishu.fridayos.REMINDER_FIRE";
    public static final String ACTION_DONE = "com.rishu.fridayos.REMINDER_DONE";
    public static final String ACTION_SNOOZE = "com.rishu.fridayos.REMINDER_SNOOZE";
    public static final String ACTION_OPEN = "com.rishu.fridayos.REMINDER_OPEN";
    private static final String CHANNEL = "friday_reminders";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty()) return;
        int nid = FridayReminderScheduler.notificationId(id);
        String action = intent.getAction();
        if (ACTION_DONE.equals(action)) {
            if (FridayReminderScheduler.done(context, id)) {
                cancelNotification(context, nid);
                FridayAssistantSpeech.speak(context, "Done, Boss.", true);
            } else {
                FridayAssistantSpeech.speak(context, "I could not save that reminder change, Boss.", true);
            }
            return;
        }
        if (ACTION_SNOOZE.equals(action)) {
            try {
                FridayReminderScheduler.snooze(context, id, 10 * 60_000L);
                cancelNotification(context, nid);
                FridayAssistantSpeech.speak(context, "Snoozed for ten minutes, Boss.", true);
            } catch (Exception ignored) {
                FridayAssistantSpeech.speak(context, "I could not save that snooze, Boss.", true);
            }
            return;
        }
        JSONObject item = FridayReminderScheduler.get(context, id);
        if (item == null) return;
        if (ACTION_OPEN.equals(action)) {
            FridayAssistantActionReceiver.savePending(context, "reminder:" + id, context.getPackageName(),
                    "Reminder", item.optString("text"));
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                context.startActivity(launch);
            }
            return;
        }
        if (!ACTION_FIRE.equals(action)) return;
        if ("fired".equals(item.optString("state")) || "done".equals(item.optString("state"))) return;
        if (!FridayReminderScheduler.fired(context, id)) return;
        show(context, item, nid);
        boolean details = FridayAssistantSpeech.canReveal(context);
        String spoken = details ? "Boss, reminder: " + item.optString("text")
                + ". Mark it done, snooze for ten minutes, or open Friday?"
                : "Boss, you have a private reminder. Unlock your phone or use headphones to hear it.";
        FridayAssistantSpeech.speak(context, spoken, false);
    }

    private static void show(Context context, JSONObject item, int nid) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "FRIDAY reminders", NotificationManager.IMPORTANCE_HIGH);
            c.setDescription("Durable reminders and reminder actions");
            nm.createNotificationChannel(c);
        }
        String id = item.optString("id");
        String text = item.optString("text");
        PendingIntent done = action(context, ACTION_DONE, id, nid + 1);
        PendingIntent snooze = action(context, ACTION_SNOOZE, id, nid + 2);
        PendingIntent open = action(context, ACTION_OPEN, id, nid + 3);
        boolean revealNow = FridayAssistantSpeech.canReveal(context);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("FRIDAY reminder")
                .setContentText(revealNow ? text : "Private reminder")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(revealNow ? text : "Unlock to view reminder"))
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(false).setOngoing(false)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(open)
                .addAction(android.R.drawable.checkbox_on_background, "Done", done)
                .addAction(android.R.drawable.ic_lock_idle_alarm, "Snooze 10m", snooze);
        PendingIntent contextual = contextAction(context, item, nid + 4);
        if (contextual != null) {
            String label = "call".equals(item.optString("actionType")) ? "Call"
                    : "message".equals(item.optString("actionType")) ? "Message" : "Open";
            b.addAction(android.R.drawable.ic_menu_send, label, contextual);
        } else {
            b.addAction(android.R.drawable.ic_menu_edit, "Reschedule", open);
        }
        NotificationCompat.Builder publicVersion = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("FRIDAY reminder")
                .setContentText("Unlock to view reminder details")
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        b.setPublicVersion(publicVersion.build());
        try { nm.notify(nid, b.build()); } catch (SecurityException ignored) {}
    }

    private static PendingIntent contextAction(Context context, JSONObject item, int requestCode) {
        String type = item.optString("actionType");
        String target = item.optString("target");
        if (target.isEmpty()) return null;
        Intent intent;
        if ("call".equals(type)) {
            intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(target)));
        } else if ("message".equals(type)) {
            intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(target)));
            intent.putExtra("sms_body", item.optString("message"));
        } else return null;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent action(Context context, String action, String id, int requestCode) {
        Intent i = new Intent(context, FridayReminderReceiver.class).setAction(action)
                .setData(Uri.parse("friday://reminder-action/" + Uri.encode(action) + "/" + Uri.encode(id)))
                .putExtra("id", id);
        return PendingIntent.getBroadcast(context, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelNotification(Context context, int nid) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(nid);
    }
}
