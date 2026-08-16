package com.rishu.fridayos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/** Durable local reminder store plus AlarmManager scheduling/restoration. */
public final class FridayReminderScheduler {
    private static final String PREFS = "friday_reminders";
    private static final String KEY_ITEMS = "items";

    private FridayReminderScheduler() {}

    public static synchronized JSONObject schedule(Context context, String id, String text, long dueAt) throws Exception {
        return schedule(context, id, text, dueAt, "", "", "");
    }

    public static synchronized JSONObject schedule(Context context, String id, String text, long dueAt,
                                                   String actionType, String target, String message) throws Exception {
        if (id == null || id.trim().isEmpty()) throw new IllegalArgumentException("Reminder id is required");
        if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("Reminder text is required");
        JSONObject items = read(context);
        JSONObject item = new JSONObject();
        item.put("id", id.trim());
        item.put("text", FridayAssistantPolicy.boundedText(text, 500));
        item.put("dueAt", Math.max(System.currentTimeMillis() + 1000L, dueAt));
        item.put("state", "scheduled");
        String normalizedAction = actionType == null ? "" : actionType.trim().toLowerCase(java.util.Locale.ROOT);
        if (!"call".equals(normalizedAction) && !"message".equals(normalizedAction)) normalizedAction = "";
        item.put("actionType", normalizedAction);
        item.put("target", FridayAssistantPolicy.boundedText(target, 100));
        item.put("message", FridayAssistantPolicy.boundedText(message, 500));
        item.put("updatedAt", System.currentTimeMillis());
        items.put(id.trim(), item);
        if (!write(context, items)) throw new IllegalStateException("Could not persist reminder");
        if (!arm(context, item)) throw new IllegalStateException("Android could not schedule the reminder alarm");
        return item;
    }

    public static synchronized JSONObject get(Context context, String id) {
        return read(context).optJSONObject(id == null ? "" : id);
    }

    public static synchronized boolean fired(Context context, String id) {
        JSONObject items = read(context);
        JSONObject item = items.optJSONObject(id);
        if (item == null) return false;
        try {
            item.put("state", "fired");
            item.put("updatedAt", System.currentTimeMillis());
            items.put(id, item);
            return write(context, items);
        } catch (Exception ignored) { return false; }
    }

    public static synchronized boolean done(Context context, String id) {
        JSONObject items = read(context);
        JSONObject item = items.optJSONObject(id);
        if (item == null) return false;
        try {
            item.put("state", "done");
            item.put("updatedAt", System.currentTimeMillis());
            items.put(id, item);
            if (!write(context, items)) return false;
            cancelAlarm(context, id);
            return true;
        } catch (Exception ignored) { return false; }
    }

    public static synchronized JSONObject snooze(Context context, String id, long delayMs) throws Exception {
        JSONObject current = get(context, id);
        if (current == null) throw new IllegalArgumentException("Reminder not found");
        return schedule(context, id, current.optString("text"), System.currentTimeMillis() + Math.max(60_000L, delayMs),
                current.optString("actionType"), current.optString("target"), current.optString("message"));
    }

    public static synchronized boolean cancel(Context context, String id) {
        JSONObject items = read(context);
        if (!items.has(id)) return false;
        items.remove(id);
        if (!write(context, items)) return false;
        cancelAlarm(context, id);
        return true;
    }

    public static synchronized JSONArray list(Context context) {
        JSONObject items = read(context);
        JSONArray out = new JSONArray();
        for (java.util.Iterator<String> it = items.keys(); it.hasNext();) {
            JSONObject item = items.optJSONObject(it.next());
            if (item != null) out.put(item);
        }
        return out;
    }

    public static synchronized void rescheduleAll(Context context) {
        reschedulePending(context);
    }

    /** Android clears alarms at reboot. Recreate only reminders that had not
        already fired; fired/done items remain historical and are never replayed. */
    public static synchronized void restoreAfterBoot(Context context) {
        reschedulePending(context);
    }

    private static void reschedulePending(Context context) {
        JSONObject items = read(context);
        long now = System.currentTimeMillis();
        for (java.util.Iterator<String> it = items.keys(); it.hasNext();) {
            JSONObject item = items.optJSONObject(it.next());
            if (item == null) continue;
            String state = item.optString("state");
            if ("done".equals(state) || "fired".equals(state)) continue;
            try {
                if (item.optLong("dueAt", 0L) <= now) item.put("dueAt", now + 5000L);
                item.put("state", "scheduled");
            } catch (Exception ignored) {}
        }
        if (!write(context, items)) return;
        for (java.util.Iterator<String> it = items.keys(); it.hasNext();) {
            JSONObject item = items.optJSONObject(it.next());
            if (item != null && "scheduled".equals(item.optString("state"))) arm(context, item);
        }
    }

    public static int notificationId(String id) {
        return 0x46000000 | ((id == null ? 0 : id.hashCode()) & 0x00ffffff);
    }

    private static boolean arm(Context context, JSONObject item) {
        String id = item.optString("id");
        long at = item.optLong("dueAt", System.currentTimeMillis() + 1000L);
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return false;
        PendingIntent pi = alarmIntent(context, id);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                alarm.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
            return true;
        } catch (SecurityException ex) {
            try {
                if (Build.VERSION.SDK_INT >= 23) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                else alarm.set(AlarmManager.RTC_WAKEUP, at, pi);
                return true;
            } catch (Exception ignored) { return false; }
        } catch (Exception ignored) { return false; }
    }

    private static void cancelAlarm(Context context, String id) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.cancel(alarmIntent(context, id));
    }

    private static PendingIntent alarmIntent(Context context, String id) {
        Intent intent = new Intent(context, FridayReminderReceiver.class)
                .setAction(FridayReminderReceiver.ACTION_FIRE)
                .setData(Uri.parse("friday://reminder/" + Uri.encode(id)))
                .putExtra("id", id);
        return PendingIntent.getBroadcast(context, notificationId(id), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static JSONObject read(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try { return new JSONObject(prefs.getString(KEY_ITEMS, "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private static boolean write(Context context, JSONObject value) {
        /* Commit before arming/returning so a process death cannot leave an alarm
           without the durable payload needed by its receiver. */
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ITEMS, value.toString()).commit();
    }
}
