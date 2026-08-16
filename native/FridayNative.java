package com.rishu.fridayos;

import android.Manifest;
import android.app.Activity;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.app.PendingIntent;
import android.content.SharedPreferences;
import android.bluetooth.BluetoothAdapter;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.ContactsContract;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "FridayNative")
public class FridayNative extends Plugin {

    /* ============ helpers ============ */
    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) { JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o; }
    private boolean granted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }

    /* Static handle for broadcast receivers (geofences) to reach the JS app. */
    private static FridayNative activePlugin;

    private static final long REPLY_AUTH_TTL_MS = 2 * 60_000L;
    private static final Map<String, ReplyAuthorization> REPLY_AUTHORIZATIONS = new ConcurrentHashMap<>();

    private static final class ReplyAuthorization {
        final String eventKey;
        final String app;
        final String recipient;
        final String text;
        final long expiresAt;
        ReplyAuthorization(String eventKey, String app, String recipient, String text, long expiresAt) {
            this.eventKey = eventKey; this.app = app; this.recipient = recipient;
            this.text = text; this.expiresAt = expiresAt;
        }
    }

    @Override
    public void load() {
        activePlugin = this;
    }

    /** Called by FridayGeofenceReceiver; no-op when the web app isn't running. */
    public static void emitGeofence(String name, String transition) {
        FridayNative p = activePlugin;
        if (p == null) return;
        try {
            JSObject o = new JSObject();
            o.put("name", name);
            o.put("transition", transition);
            p.notifyListeners("geofenceEvent", o);
        } catch (Exception ignored) {}
    }

    /* ============ PERMISSIONS ============ */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        String p = call.getString("permission", "");
        JSObject r = ok();
        r.put("granted", granted(p));
        call.resolve(r);
    }

    @PluginMethod
    public void requestAllPermissions(PluginCall call) {
        String[] perms = {
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.ANSWER_PHONE_CALLS,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.POST_NOTIFICATIONS
        };
        List<String> missing = new ArrayList<>();
        for (String p : perms) if (!granted(p)) missing.add(p);
        if (Build.VERSION.SDK_INT >= 29 && !granted(Manifest.permission.ACTIVITY_RECOGNITION))
            missing.add(Manifest.permission.ACTIVITY_RECOGNITION);
        if (!missing.isEmpty()) {
            getActivity().requestPermissions(missing.toArray(new String[0]), 9911);
        }
        JSObject r = ok();
        r.put("requested", missing.size());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String p = call.getString("permission", "");
        if (!granted(p)) getActivity().requestPermissions(new String[]{p}, 9912);
        call.resolve(ok());
    }

    @PluginMethod
    public void hasSpecialPermission(PluginCall call) {
        String kind = call.getString("kind", "");
        boolean has = false;
        Context ctx = getContext();
        try {
            switch (kind) {
                case "overlay":
                    has = Settings.canDrawOverlays(ctx); break;
                case "notification_listener": {
                    String flat = Settings.Secure.getString(ctx.getContentResolver(),
                            "enabled_notification_listeners");
                    has = flat != null && flat.contains(ctx.getPackageName());
                    break;
                }
                case "accessibility": {
                    String flat = Settings.Secure.getString(ctx.getContentResolver(),
                            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                    has = flat != null && flat.contains(ctx.getPackageName());
                    break;
                }
                case "dnd": {
                    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                    has = nm.isNotificationPolicyAccessGranted();
                    break;
                }
                case "write_settings":
                    has = Settings.System.canWrite(ctx); break;
                case "usage_access": {
                    AppOpsManager aom = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
                    int mode = aom.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                            android.os.Process.myUid(), ctx.getPackageName());
                    has = (mode == AppOpsManager.MODE_ALLOWED);
                    break;
                }
            }
        } catch (Exception ignored) {}
        JSObject r = ok(); r.put("granted", has); call.resolve(r);
    }

    @PluginMethod
    public void openSpecialSetting(PluginCall call) {
        String kind = call.getString("kind", "");
        Context ctx = getContext();
        Intent i = null;
        try {
            switch (kind) {
                case "overlay":
                    i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + ctx.getPackageName())); break;
                case "notification_listener":
                    i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"); break;
                case "accessibility":
                    i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS); break;
                case "battery_optimization":
                    i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS); break;
                case "exact_alarm":
                    if (Build.VERSION.SDK_INT >= 31) i = new Intent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM");
                    break;
                case "dnd":
                    i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS); break;
                case "write_settings":
                    i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,
                            Uri.parse("package:" + ctx.getPackageName())); break;
                case "usage_access":
                    i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS); break;
                case "app_settings":
                    i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + ctx.getPackageName())); break;
            }
            if (i == null) { call.resolve(fail("unknown")); return; }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ CONTACTS ============ */
    @PluginMethod
    public void getContacts(PluginCall call) {
        if (!granted(Manifest.permission.READ_CONTACTS)) { call.resolve(fail("no_permission")); return; }
        JSArray arr = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{
                        ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                        ContactsContract.CommonDataKinds.Phone.NUMBER },
                    null, null,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            while (c != null && c.moveToNext()) {
                String name = c.getString(1);
                String num  = c.getString(2);
                if (TextUtils.isEmpty(name) || TextUtils.isEmpty(num)) continue;
                String key = name.toLowerCase();
                if (seen.contains(key)) continue;
                seen.add(key);
                JSObject o = new JSObject();
                o.put("id", c.getString(0));
                o.put("name", name);
                o.put("phone", num.replaceAll("[\\s-()]", ""));
                arr.put(o);
            }
        } catch (Exception e) { call.resolve(fail(e.getMessage())); return; }
        finally { if (c != null) c.close(); }
        JSObject r = ok(); r.put("contacts", arr); call.resolve(r);
    }

    /* ============ CALLING ============ */
    @PluginMethod
    public void placeCall(PluginCall call) {
        String num = call.getString("number", "");
        if (TextUtils.isEmpty(num)) { call.resolve(fail("no_number")); return; }
        try {
            Intent i = granted(Manifest.permission.CALL_PHONE)
                    ? new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + num))
                    : new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + num));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ SMS ============ */
    @PluginMethod
    public void sendSMS(PluginCall call) {
        String num = call.getString("number", "");
        String msg = call.getString("message", "");
        if (!granted(Manifest.permission.SEND_SMS)) { call.resolve(fail("no_permission")); return; }
        try {
            SmsManager sm = Build.VERSION.SDK_INT >= 31
                    ? getContext().getSystemService(SmsManager.class)
                    : SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(msg);
            sm.sendMultipartTextMessage(num, null, parts, null, null);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void getLatestOTP(PluginCall call) {
        if (!granted(Manifest.permission.READ_SMS)) { call.resolve(fail("no_permission")); return; }
        int within = call.getInt("within", 300);
        long since = System.currentTimeMillis() - (within * 1000L);
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    new String[]{ Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.ADDRESS },
                    Telephony.Sms.DATE + ">?", new String[]{ String.valueOf(since) },
                    Telephony.Sms.DATE + " DESC");
            Pattern p = Pattern.compile("\\b(\\d{4,8})\\b");
            while (c != null && c.moveToNext()) {
                String body = c.getString(0);
                if (body == null) continue;
                String low = body.toLowerCase();
                if (!(low.contains("otp") || low.contains("code") || low.contains("verification")
                        || low.contains("password") || low.contains("verify"))) continue;
                Matcher m = p.matcher(body);
                if (m.find()) {
                    JSObject r = ok();
                    r.put("otp", m.group(1));
                    r.put("sender", c.getString(2));
                    r.put("body", body);
                    call.resolve(r);
                    return;
                }
            }
            call.resolve(fail("not_found"));
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
        finally { if (c != null) c.close(); }
    }

    @PluginMethod
    public void getRecentSMS(PluginCall call) {
        if (!granted(Manifest.permission.READ_SMS)) { call.resolve(fail("no_permission")); return; }
        int limit = call.getInt("limit", 10);
        JSArray arr = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    new String[]{ Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE },
                    null, null, Telephony.Sms.DATE + " DESC");
            int n = 0;
            while (c != null && c.moveToNext() && n < limit) {
                JSObject o = new JSObject();
                o.put("from", c.getString(0));
                o.put("body", c.getString(1));
                o.put("date", c.getLong(2));
                arr.put(o); n++;
            }
        } catch (Exception e) { call.resolve(fail(e.getMessage())); return; }
        finally { if (c != null) c.close(); }
        JSObject r = ok(); r.put("messages", arr); call.resolve(r);
    }

    /* ============ NOTIFICATION LISTENER ============ */
    @PluginMethod
    public void startNotificationListener(PluginCall call) {
        FridayNotificationService.setPlugin(this);
        call.resolve(ok());
    }

    public void emitNotification(String pkg, String title, String text) {
        emitNotification("", pkg, title, text, "OTHER", false, false, false);
    }

    public void emitNotification(String key, String pkg, String title, String text, String category,
                                 boolean sensitive, boolean replyable, boolean nativeAnnounced) {
        JSObject o = new JSObject();
        o.put("key", key == null ? "" : key);
        o.put("pkg", pkg == null ? "" : pkg);
        o.put("title", title == null ? "" : title);
        o.put("text", text == null ? "" : text);
        o.put("category", category == null ? "OTHER" : category);
        o.put("sensitive", sensitive);
        o.put("replyable", replyable);
        o.put("nativeAnnounced", nativeAnnounced);
        o.put("canReveal", FridayAssistantSpeech.canReveal(getContext()));
        o.put("time", System.currentTimeMillis());
        notifyListeners("notificationPosted", o);
    }

    /* Read the notification SHADE on demand - not just events that arrived
       while the app was running. "See my notifications" works right after
       the app opens. Requires the listener to be enabled. */
    @PluginMethod
    public void getActiveNotifications(PluginCall call) {
        try {
            if (!FridayAssistantSpeech.canDisplayPrivateContent(getContext())) {
                call.resolve(fail("private_or_locked")); return;
            }
            if (!FridayNotificationService.isEnabled()) { call.resolve(fail("listener_off")); return; }
            android.service.notification.StatusBarNotification[] all = FridayNotificationService.active();
            java.util.Arrays.sort(all, (a, b) -> Long.compare(b.getPostTime(), a.getPostTime()));
            JSArray out = new JSArray();
            int n = 0, ongoingKept = 0;
            for (android.service.notification.StatusBarNotification sbn : all) {
                if (sbn == null) continue;
                String pkg = sbn.getPackageName();
                if (pkg == null || pkg.equals(getContext().getPackageName())) continue;
                Notification notif = sbn.getNotification();
                if (notif == null) continue;
                if ((notif.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
                android.os.Bundle ex = notif.extras;
                if (ex == null) continue;
                CharSequence t = ex.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence x = ex.getCharSequence(Notification.EXTRA_TEXT);
                String title = t == null ? "" : t.toString();
                String text  = x == null ? "" : x.toString();
                if (title.isEmpty() && text.isEmpty()) continue;
                boolean ongoing = (notif.flags & Notification.FLAG_ONGOING_EVENT) != 0;
                if (ongoing && ongoingKept++ >= 2) continue;   // mostly silent junk - keep max 2
                JSObject o = new JSObject();
                o.put("pkg", pkg);
                o.put("title", title);
                o.put("text", text);
                o.put("when", sbn.getPostTime());
                o.put("ongoing", ongoing);
                out.put(o);
                if (++n >= 8) break;
            }
            JSObject r = ok(); r.put("items", out); r.put("count", out.length());
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ============ SCREEN EYES (v7.6) ============ */
    @PluginMethod
    public void readScreenText(PluginCall call) {
        String txt = FridayAccessibility.dumpScreenText(4000);
        if (txt == null) { call.resolve(fail("accessibility_off")); return; }
        JSObject r = ok();
        r.put("text", txt);
        call.resolve(r);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ============ SCREEN TIME (usage stats) ============ */
    /** How much you used the phone: top apps + total minutes for the last N days.
        Requires the Usage Access special permission. */
    @PluginMethod
    public void getUsageStats(PluginCall call) {
        try {
            Context ctx = getContext();
            AppOpsManager aom = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            int mode = aom.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), ctx.getPackageName());
            if (mode != AppOpsManager.MODE_ALLOWED) { call.resolve(fail("usage_access_off")); return; }

            int days = Math.max(1, call.getInt("days", 1));
            long end = System.currentTimeMillis();
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
            cal.set(java.util.Calendar.MINUTE, 0);
            cal.set(java.util.Calendar.SECOND, 0);
            cal.add(java.util.Calendar.DAY_OF_YEAR, -(days - 1));
            long begin = cal.getTimeInMillis();

            UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            java.util.Map<String, UsageStats> stats = usm.queryAndAggregateUsageStats(begin, end);
            if (stats == null) stats = new java.util.HashMap<>();

            java.util.List<UsageStats> list = new ArrayList<>(stats.values());
            list.sort((a, b) -> Long.compare(b.getTotalTimeInForeground(), a.getTotalTimeInForeground()));

            PackageManager pm = ctx.getPackageManager();
            JSArray items = new JSArray();
            long totalMs = 0;
            int n = 0;
            for (UsageStats u : list) {
                long fg = u.getTotalTimeInForeground();
                if (fg < 60000) continue;               // under a minute is noise
                totalMs += fg;
                if (n < 8) {
                    String pkg = u.getPackageName();
                    String label = pkg;
                    try { label = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0))); }
                    catch (Exception ignored) {}
                    JSObject o = new JSObject();
                    o.put("pkg", pkg);
                    o.put("label", label);
                    o.put("minutes", fg / 60000);
                    items.put(o);
                    n++;
                }
            }
            JSObject r = ok();
            r.put("items", items);
            r.put("totalMinutes", totalMs / 60000);
            r.put("days", days);
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ============ FIND MY PHONE ============ */
    private static android.media.Ringtone finderRing = null;

    @PluginMethod
    public void phoneFinder(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            Context ctx = getContext();
            if (!on) {
                try { if (finderRing != null && finderRing.isPlaying()) finderRing.stop(); } catch (Throwable ignored) {}
                finderRing = null;
                call.resolve(ok());
                return;
            }
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
            }
            try { if (finderRing != null && finderRing.isPlaying()) { call.resolve(ok()); return; } } catch (Throwable ignored) {}
            finderRing = android.media.RingtoneManager.getRingtone(ctx,
                    android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM));
            if (finderRing == null) { call.resolve(fail("no_ringtone")); return; }
            finderRing.setStreamType(AudioManager.STREAM_ALARM);
            finderRing.play();
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ============ FOREGROUND SERVICE ============ */
    @PluginMethod
    public void startForegroundService(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), FridayService.class);
            i.putExtra("title", FridayAssistantPolicy.boundedText(
                    call.getString("title", "FRIDAY always-on mode"), 80));
            i.putExtra("text", FridayAssistantPolicy.boundedText(
                    call.getString("text", "Smart prompts, reminders and call assistance active"), 180));
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            /* Starting an FGS is asynchronous. Resolve only after the service has
               actually promoted itself, rather than equating an accepted request
               with a running always-on notification. */
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (FridayService.isForegroundRunning()) call.resolve(ok());
                else call.resolve(fail("foreground_service_not_running"));
            }, 1500L);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void stopForegroundService(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), FridayService.class));
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setBootStart(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        boolean persisted = getContext().getSharedPreferences("friday", Context.MODE_PRIVATE)
                .edit().putBoolean("boot_start", on).commit();
        call.resolve(persisted ? ok() : fail("boot_setting_persist_failed"));
    }

    /* ============ SYSTEM TOGGLES ============ */
    @PluginMethod
    public void setWifi(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                // Android 10+ forbids programmatic toggle - open the panel instead
                Intent i = new Intent(Settings.Panel.ACTION_WIFI);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject r = ok(); r.put("opened_panel", true); call.resolve(r);
            } else {
                WifiManager wm = (WifiManager) getContext().getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                wm.setWifiEnabled(on);
                call.resolve(ok());
            }
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setBluetooth(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            if (a == null) { call.resolve(fail("no_bluetooth")); return; }
            if (Build.VERSION.SDK_INT >= 33) {
                Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject r = ok(); r.put("opened_panel", true); call.resolve(r);
            } else {
                if (on) a.enable(); else a.disable();
                call.resolve(ok());
            }
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            String id = cm.getCameraIdList()[0];
            cm.setTorchMode(id, on);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setDND(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            NotificationManager nm = (NotificationManager) getContext()
                    .getSystemService(Context.NOTIFICATION_SERVICE);
            if (!nm.isNotificationPolicyAccessGranted()) { call.resolve(fail("no_dnd_access")); return; }
            nm.setInterruptionFilter(on ? NotificationManager.INTERRUPTION_FILTER_NONE
                                        : NotificationManager.INTERRUPTION_FILTER_ALL);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        int pct = call.getInt("percent", 50);
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * pct / 100f), 0);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        int pct = call.getInt("percent", 50);
        try {
            if (!Settings.System.canWrite(getContext())) { call.resolve(fail("no_write_settings")); return; }
            Settings.System.putInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, Math.round(255 * pct / 100f));
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setAirplane(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject r = ok(); r.put("opened_panel", true); call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void getSystemState(PluginCall call) {
        JSObject r = ok();
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            r.put("wifi", wm != null && wm.isWifiEnabled());
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            r.put("bluetooth", a != null && a.isEnabled());
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            r.put("volume", Math.round(am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max));
            int brightness = Settings.System.getInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, -1);
            if (brightness >= 0) r.put("brightness", Math.round(brightness * 100f / 255f));
        } catch (Exception ignored) {}
        call.resolve(r);
    }

    /* ============ APPS ============ */
    @PluginMethod
    public void listApps(PluginCall call) {
        JSArray arr = new JSArray();
        try {
            PackageManager pm = getContext().getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN, null);
            main.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
            for (ResolveInfo ri : apps) {
                JSObject o = new JSObject();
                o.put("label", ri.loadLabel(pm).toString());
                o.put("pkg", ri.activityInfo.packageName);
                arr.put(o);
            }
        } catch (Exception e) { call.resolve(fail(e.getMessage())); return; }
        JSObject r = ok(); r.put("apps", arr); call.resolve(r);
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String pkg = call.getString("pkg", "");
        try {
            Intent i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) { call.resolve(fail("not_found")); return; }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ MEDIA ============ */
    @PluginMethod
    public void mediaControl(PluginCall call) {
        String action = call.getString("action", "playpause");
        int code;
        switch (action) {
            case "next": code = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            case "stop": code = KeyEvent.KEYCODE_MEDIA_STOP; break;
            case "play": code = KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": code = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            default: code = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        }
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
            am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ DEVICE INFO / ACTIONS ============ */
    @PluginMethod
    public void ringLoud(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            am.setStreamVolume(AudioManager.STREAM_MUSIC,
                    am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void getBatteryDetail(PluginCall call) {
        try {
            BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
            JSObject r = ok();
            r.put("level", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY));
            boolean charging = false;
            try {
                android.content.IntentFilter f = new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent bs = getContext().registerReceiver(null, f);
                if (bs != null) {
                    int st = bs.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    charging = st == BatteryManager.BATTERY_STATUS_CHARGING
                            || st == BatteryManager.BATTERY_STATUS_FULL;
                }
            } catch (Throwable ignored) {}
            r.put("charging", charging);
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ v15 DEVX: thermal + sensors (Phase 10 completion) ============ */

    /** Real device temperature: battery temp (BatteryManager) + CPU temp
        (thermal-zone files, best-effort) + throttling state (API 29+). */
    @PluginMethod
    public void getThermal(PluginCall call) {
        JSObject r = ok();
        try {
            double batteryC = Double.NaN;
            try {
                // BATTERY_PROPERTY_TEMPERATURE is API 28+; the ACTION_BATTERY_CHANGED
                // intent carries EXTRA_TEMPERATURE (tenths of °C) on ALL API levels.
                android.content.IntentFilter f = new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent bs = getContext().registerReceiver(null, f);
                if (bs != null) {
                    int tenths = bs.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                    if (tenths != Integer.MIN_VALUE) batteryC = tenths / 10.0;
                }
            } catch (Throwable ignored) {}

            Double cpuC = null;
            try {
                // /sys/class/thermal/thermal_zone*/temp is in millidegrees; pick
                // the zone labelled "cpu" if present, else the first valid zone.
                java.io.File dir = new java.io.File("/sys/class/thermal");
                java.io.File[] zones = dir.listFiles();
                double best = Double.NaN;
                if (zones != null) {
                    for (java.io.File z : zones) {
                        if (!z.isDirectory()) continue;
                        java.io.File type = new java.io.File(z, "type");
                        java.io.File temp = new java.io.File(z, "temp");
                        if (!type.exists() || !temp.exists()) continue;
                        String tname = readSmall(type).trim().toLowerCase();
                        String tval = readSmall(temp).trim();
                        if (tval.isEmpty()) continue;
                        try {
                            double v = Double.parseDouble(tval) / 1000.0;
                            if (v > 0 && (tname.contains("cpu") || Double.isNaN(best))) best = v;
                        } catch (Throwable ignored) {}
                    }
                }
                if (!Double.isNaN(best)) cpuC = Math.round(best * 10) / 10.0;
            } catch (Throwable ignored) {}

            int thermalStatus = 0;   // 0 = none (not throttling)
            boolean throttling = false;
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                    thermalStatus = pm.getCurrentThermalStatus();
                    throttling = thermalStatus >= android.os.PowerManager.THERMAL_STATUS_LIGHT;
                } catch (Throwable ignored) {}
            }
            // battery temp drives the primary celsius (matches devx.thermalStatus tiers)
            double c = !Double.isNaN(batteryC) ? batteryC
                     : (cpuC != null ? cpuC : Double.NaN);
            r.put("celsius", Double.isNaN(c) ? null : Math.round(c * 10) / 10.0);
            r.put("batteryCelsius", Double.isNaN(batteryC) ? null : Math.round(batteryC * 10) / 10.0);
            r.put("cpuCelsius", cpuC);
            r.put("throttling", throttling);
            r.put("thermalStatus", thermalStatus);
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /** Sensor availability + one-shot latest readings (no continuous listener). */
    @PluginMethod
    public void getSensors(PluginCall call) {
        JSObject r = ok();
        try {
            SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            if (sm == null) { call.resolve(fail("no_sensor_service")); return; }
            JSObject sensors = new JSObject();
            final Object[] vals = new Object[8];
            final boolean[] got = new boolean[8];
            SensorEventListener lis = new SensorEventListener() {
                @Override public void onSensorChanged(SensorEvent e) {
                    int i = sensorIndex(e.sensor.getType());
                    if (i < 0) return;
                    float[] v = e.values;
                    switch (e.sensor.getType()) {
                        case Sensor.TYPE_ACCELEROMETER: if (!got[i]) { vals[i] = new double[]{ rnd(v[0]), rnd(v[1]), rnd(v[2]) }; got[i]=true; } break;
                        case Sensor.TYPE_GYROSCOPE:      if (!got[i]) { vals[i] = new double[]{ rnd(v[0]), rnd(v[1]), rnd(v[2]) }; got[i]=true; } break;
                        case Sensor.TYPE_LIGHT:          if (!got[i]) { vals[i] = Math.round(v[0]); got[i]=true; } break;
                        case Sensor.TYPE_PROXIMITY:      if (!got[i]) { vals[i] = rnd(v[0]); got[i]=true; } break;
                        case Sensor.TYPE_MAGNETIC_FIELD: if (!got[i]) { vals[i] = new double[]{ rnd(v[0]), rnd(v[1]), rnd(v[2]) }; got[i]=true; } break;
                        case Sensor.TYPE_STEP_COUNTER:   if (!got[i]) { vals[i] = Math.round(v[0]); got[i]=true; } break;
                        default: break;
                    }
                }
                @Override public void onAccuracyChanged(Sensor s, int a) {}
            };
            int[] types = { Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE, Sensor.TYPE_LIGHT,
                            Sensor.TYPE_PROXIMITY, Sensor.TYPE_MAGNETIC_FIELD, Sensor.TYPE_STEP_COUNTER,
                            Sensor.TYPE_GRAVITY, Sensor.TYPE_ROTATION_VECTOR };
            java.util.List<Sensor> regs = new java.util.ArrayList<>();
            for (int ty : types) {
                Sensor s = sm.getDefaultSensor(ty);
                if (s != null) { sm.registerListener(lis, s, SensorManager.SENSOR_DELAY_UI); regs.add(s); }
            }
            // wait briefly for first events, then resolve (never block long)
            final boolean[] done = { false };
            Handler h = new Handler(Looper.getMainLooper());
            h.postDelayed(() -> {
                for (Sensor s : regs) { try { sm.unregisterListener(lis, s); } catch (Throwable ignored) {} }
                sensors.put("accelerometer", pack(0, vals[0], got[0]));
                sensors.put("gyroscope", pack(1, vals[1], got[1]));
                sensors.put("light", pack(2, vals[2], got[2]));
                sensors.put("proximity", pack(3, vals[3], got[3]));
                sensors.put("magnetometer", pack(4, vals[4], got[4]));
                sensors.put("stepCounter", pack(5, vals[5], got[5]));
                sensors.put("gravity", pack(6, vals[6], got[6]));
                sensors.put("rotationVector", pack(7, vals[7], got[7]));
                r.put("sensors", sensors);
                if (!done[0]) { done[0] = true; call.resolve(r); }
            }, 500);
            h.postDelayed(() -> { if (!done[0]) { done[0] = true; for (Sensor s : regs) { try { sm.unregisterListener(lis, s); } catch (Throwable ignored) {} } call.resolve(r); } }, 1200);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    private static int sensorIndex(int type) {
        switch (type) {
            case Sensor.TYPE_ACCELEROMETER: return 0;
            case Sensor.TYPE_GYROSCOPE: return 1;
            case Sensor.TYPE_LIGHT: return 2;
            case Sensor.TYPE_PROXIMITY: return 3;
            case Sensor.TYPE_MAGNETIC_FIELD: return 4;
            case Sensor.TYPE_STEP_COUNTER: return 5;
            case Sensor.TYPE_GRAVITY: return 6;
            case Sensor.TYPE_ROTATION_VECTOR: return 7;
            default: return -1;
        }
    }
    private static double rnd(float f) { return Math.round(f * 100.0) / 100.0; }
    private static JSObject pack(int i, Object v, boolean got) {
        JSObject o = new JSObject();
        o.put("present", v != null || got);
        if (v instanceof double[]) { double[] d = (double[]) v; o.put("x", d[0]); o.put("y", d[1]); o.put("z", d[2]); }
        else if (v != null) o.put("value", v.toString());
        return o;
    }
    private static String readSmall(java.io.File f) {
        try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(f))) {
            return br.readLine() == null ? "" : br.readLine();
        } catch (Throwable ignored) { return ""; }
    }
@PluginMethod
    public void getStorageInfo(PluginCall call) {
        try {
            StatFs s = new StatFs(Environment.getDataDirectory().getPath());
            long free = s.getAvailableBytes(), total = s.getTotalBytes();
            JSObject r = ok();
            r.put("freeGB", Math.round(free / 1e9 * 10) / 10.0);
            r.put("totalGB", Math.round(total / 1e9 * 10) / 10.0);
            r.put("usedPercent", Math.round((total - free) * 100.0 / total));
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void globalAction(PluginCall call) {
        String a = call.getString("action", "home");
        boolean sent = FridayAccessibility.doGlobal(a);
        call.resolve(sent ? ok() : fail("accessibility_off"));
    }

    /* ============ OVERLAY BUBBLE ============ */
    @PluginMethod
    public void showBubble(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            if (on && !Settings.canDrawOverlays(getContext())) { call.resolve(fail("no_overlay_permission")); return; }
            Intent i = new Intent(getContext(), FridayBubbleService.class);
            if (on) {
                if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
                else getContext().startService(i);
            } else {
                getContext().stopService(i);
            }
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void updateBubble(PluginCall call) {
        FridayBubbleService.setState(call.getString("state", "idle"));
        call.resolve(ok());
    }

    /* ============ SYSTEM ALARM (real Clock app) ============ */
    @PluginMethod
    public void setSystemAlarm(PluginCall call) {
        int hour = call.getInt("hour", 7);
        int minute = call.getInt("minute", 0);
        String label = call.getString("label", "FRIDAY");
        String repeat = call.getString("repeat", "once");
        try {
            Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
            i.putExtra(AlarmClock.EXTRA_HOUR, hour);
            i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
            i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
            i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
            java.util.ArrayList<Integer> days = new java.util.ArrayList<>();
            if ("daily".equals(repeat)) {
                for (int d = 1; d <= 7; d++) days.add(d);
            } else if ("weekdays".equals(repeat)) {
                days.add(java.util.Calendar.MONDAY); days.add(java.util.Calendar.TUESDAY);
                days.add(java.util.Calendar.WEDNESDAY); days.add(java.util.Calendar.THURSDAY);
                days.add(java.util.Calendar.FRIDAY);
            } else if ("weekends".equals(repeat)) {
                days.add(java.util.Calendar.SATURDAY); days.add(java.util.Calendar.SUNDAY);
            } else if (repeat.matches("[0-6](,[0-6])*")) {
                for (String d : repeat.split(",")) days.add(Integer.parseInt(d) + 1);
            }
            if (!days.isEmpty()) i.putExtra(AlarmClock.EXTRA_DAYS, days);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void setSystemTimer(PluginCall call) {
        int seconds = call.getInt("seconds", 60);
        String label = call.getString("label", "FRIDAY timer");
        try {
            Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
            i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
            i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
            i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void showAlarms(PluginCall call) {
        try {
            Intent i = new Intent(AlarmClock.ACTION_SHOW_ALARMS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ WHATSAPP SEND ============ */
    @PluginMethod
    public void whatsappSend(PluginCall call) {
        String number = call.getString("number", "").replaceAll("[^0-9]", "");
        String message = call.getString("message", "");
        String cc = call.getString("cc", "91").replaceAll("[^0-9]", "");
        if (cc.isEmpty()) cc = "91";
        boolean autoSend = call.getBoolean("autoSend", true);
        try {
            if (number.length() == 10) number = cc + number;
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setData(Uri.parse("https://api.whatsapp.com/send?phone=" + number
                    + "&text=" + Uri.encode(message)));
            i.setPackage("com.whatsapp");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(i); }
            catch (Exception noWa) {
                Intent w = new Intent(Intent.ACTION_VIEW);
                w.setData(Uri.parse("https://api.whatsapp.com/send?phone=" + number
                        + "&text=" + Uri.encode(message)));
                w.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(w);
            }
            if (autoSend) FridayAccessibility.requestAutoSend();
            JSObject r = ok();
            r.put("autoSend", autoSend && FridayAccessibility.isEnabled());
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ v14.1: share / save an image (shared photo, camera shot) ============ */

    /** Share an image (base64) to a WhatsApp chat: ACTION_SEND + FileProvider URI.
        The photo is really ATTACHED — WhatsApp opens with it ready for the chat. */
    @PluginMethod
    public void sendImage(PluginCall call) {
        String b64 = call.getString("base64", "");
        String number = call.getString("number", "").replaceAll("[^0-9]", "");
        String cc = call.getString("cc", "91").replaceAll("[^0-9]", "");
        String caption = call.getString("caption", "");
        if (cc.isEmpty()) cc = "91";
        try {
            if (number.length() == 10) number = cc + number;
            byte[] bytes = decodeB64(b64);
            if (bytes == null || bytes.length == 0) { call.resolve(fail("bad_image")); return; }
            String ext = guessExt(call.getString("mime", ""));
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "share");
            if (!dir.exists()) dir.mkdirs();
            java.io.File file = new java.io.File(dir, "friday_share_" + System.currentTimeMillis() + ext);
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) { out.write(bytes); }
            Uri contentUri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mimeOf(ext));
            i.putExtra(Intent.EXTRA_STREAM, contentUri);
            if (!caption.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, caption);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                Intent wa = new Intent(i);
                wa.setPackage("com.whatsapp");
                getContext().startActivity(wa);
            } catch (Exception noWa) {
                getContext().startActivity(Intent.createChooser(i, "Send photo via"));
            }
            JSObject r = ok();
            r.put("path", file.getAbsolutePath());
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /** Save an image (base64) to the device gallery (Pictures/FRIDAY). */
    @PluginMethod
    public void saveImage(PluginCall call) {
        String b64 = call.getString("base64", "");
        try {
            byte[] bytes = decodeB64(b64);
            if (bytes == null || bytes.length == 0) { call.resolve(fail("bad_image")); return; }
            String ext = guessExt(call.getString("mime", ""));
            String name = "friday_" + System.currentTimeMillis() + ext;
            String mime = mimeOf(ext);
            if (Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/FRIDAY");
                Uri uri = getContext().getContentResolver().insert(
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) { call.resolve(fail("insert_failed")); return; }
                try (java.io.OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                    if (out != null) out.write(bytes);
                }
            } else {
                java.io.File dir = new java.io.File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "FRIDAY");
                if (!dir.exists()) dir.mkdirs();
                java.io.File f = new java.io.File(dir, name);
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) { out.write(bytes); }
            }
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    private static byte[] decodeB64(String b64) {
        if (b64 == null || b64.isEmpty()) return null;
        if (b64.startsWith("data:")) b64 = b64.substring(b64.indexOf(',') + 1);
        try { return android.util.Base64.decode(b64, android.util.Base64.DEFAULT); }
        catch (Throwable t) { return null; }
    }
    private static String guessExt(String mime) {
        if (mime == null) return ".jpg";
        String m = mime.toLowerCase();
        if (m.contains("png")) return ".png";
        if (m.contains("webp")) return ".webp";
        if (m.contains("gif")) return ".gif";
        return ".jpg";
    }


    /* ============ v15 Phase 9: biometric authentication (BiometricPrompt) ============ */
    @PluginMethod
    public void biometricAuth(PluginCall call) {
        try {
            android.app.Activity act = getActivity();
            if (act == null) { call.resolve(fail("no_activity")); return; }
            if (Build.VERSION.SDK_INT < 28) { call.resolve(fail("unsupported_api")); return; }
            final PluginCall fcall = call;
            /* androidx.biometric 1.1.0 needs a FragmentActivity (not a plain
               Activity). Capacitor's BridgeActivity extends AppCompatActivity,
               so the cast is always safe here. */
            if (!(act instanceof androidx.fragment.app.FragmentActivity)) { call.resolve(fail("not_fragment_activity")); return; }
            androidx.fragment.app.FragmentActivity fa = (androidx.fragment.app.FragmentActivity) act;
            java.util.concurrent.Executor executor = androidx.core.content.ContextCompat.getMainExecutor(act);
            androidx.biometric.BiometricPrompt prompt = new androidx.biometric.BiometricPrompt(fa, executor,
                new androidx.biometric.BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(androidx.biometric.BiometricPrompt.AuthenticationResult result) {
                        JSObject r = ok(); r.put("ok", true); fcall.resolve(r);
                    }
                    @Override public void onAuthenticationError(int code, CharSequence err) {
                        fcall.resolve(fail(err != null ? err.toString() : "biometric_error_" + code));
                    }
                    @Override public void onAuthenticationFailed() {
                        fcall.resolve(fail("failed"));
                    }
                });
            androidx.biometric.BiometricPrompt.PromptInfo info = new androidx.biometric.BiometricPrompt.PromptInfo.Builder()
                .setTitle("FRIDAY unlock")
                .setSubtitle("Fingerprint / face se FRIDAY kholo")
                /* DEVICE_CREDENTIAL gives its own system fallback (PIN/pattern),
                   so a custom negative button must NOT be set (Android throws
                   IllegalArgumentException if both are used). */
                .setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK | androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();
            prompt.authenticate(info);
            call.setKeepAlive(true);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ============ v15 Phase 7: dynamic shortcuts ============ */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT < 25) { call.resolve(fail("unsupported")); return; }
            android.content.pm.ShortcutManager sm = getContext().getSystemService(android.content.pm.ShortcutManager.class);
            if (sm == null) { call.resolve(fail("no_manager")); return; }
            com.getcapacitor.JSArray arr = call.getArray("shortcuts");
            java.util.List<android.content.pm.ShortcutInfo> list = new java.util.ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                Object _o = arr.get(i);
                if (!(_o instanceof com.getcapacitor.JSObject)) continue;
                com.getcapacitor.JSObject o = (com.getcapacitor.JSObject) _o;
                if (o == null) continue;
                String id = o.getString("id", "s" + i);
                String title = o.getString("title", "FRIDAY");
                String action = o.getString("action", "voice");
                Intent intent = new Intent(getContext(), getActivity().getClass())
                        .setAction(Intent.ACTION_MAIN)
                        .putExtra("shortcut", action);
                int iconRes = 0;
                try {
                    iconRes = getContext().getResources().getIdentifier("ic_stat_icon", "drawable", getContext().getPackageName());
                } catch (Throwable ignored) {}
                android.content.pm.ShortcutInfo.Builder b = new android.content.pm.ShortcutInfo.Builder(getContext(), id)
                        .setShortLabel(title)
                        .setLongLabel(title)
                        .setIntent(intent);
                if (iconRes != 0) b.setIcon(android.graphics.drawable.Icon.createWithResource(getContext(), iconRes));
                else b.setIcon(android.graphics.drawable.Icon.createWithResource(getContext(), android.R.drawable.ic_btn_speak_now));
                list.add(b.build());
            }
            sm.setDynamicShortcuts(list);
            JSObject r = ok(); r.put("count", list.size());
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    private static String mimeOf(String ext) {        String e = (ext == null ? "" : ext.toLowerCase());
        if (e.contains("png")) return "image/png";
        if (e.contains("webp")) return "image/webp";
        if (e.contains("gif")) return "image/gif";
        return "image/jpeg";
    }

    /* ============ v8.1 EYES: screenshot + coordinate tap ============ */
    @PluginMethod
    public void screenShot(PluginCall call) {
        if (!FridayAccessibility.isEnabled()) { call.resolve(fail("a11y_off")); return; }
        if (Build.VERSION.SDK_INT < 30) { call.resolve(fail("unsupported_android")); return; }
        boolean started = FridayAccessibility.takeShot(new FridayAccessibility.ShotCb() {
            @Override public void onShot(android.graphics.Bitmap bmp) {
                JSObject r;
                if (bmp == null) {
                    r = fail("capture_failed");
                } else {
                    try {
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, bos);
                        bmp.recycle();
                        r = ok();
                        r.put("b64", android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP));
                    } catch (Throwable t) { r = fail("encode_failed"); }
                }
                call.resolve(r);
            }
        });
        if (!started) call.resolve(fail("a11y_off"));
    }

    @PluginMethod
    public void tapAt(PluginCall call) {
        Float xf = call.getFloat("x");
        Float yf = call.getFloat("y");
        boolean done = xf != null && yf != null && FridayAccessibility.tapAt(xf.floatValue(), yf.floatValue());
        call.resolve(done ? ok() : fail(FridayAccessibility.isEnabled() ? "dispatch_failed" : "a11y_off"));
    }

    /* ============ ON-DEVICE LLM: model discovery ============ */

    /** Finds *.gguf model files in Downloads, Documents and the app's own
     *  directories, so the web layer can offer a one-tap picker instead of
     *  making the user type a storage path. Never throws - empty list on
     *  any storage restriction. */
    @PluginMethod
    public void scanModels(PluginCall call) {
        JSArray out = new JSArray();
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        try {
            java.io.File[] roots = new java.io.File[] {
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                getContext().getExternalFilesDir(null),
                getContext().getFilesDir()
            };
            for (java.io.File root : roots) {
                if (root != null && root.isDirectory()) scanDir(root, out, seen, 0);
            }
        } catch (Throwable ignored) {}
        JSObject r = new JSObject();
        r.put("models", out);
        call.resolve(r);
    }

    private void scanDir(java.io.File dir, JSArray out, java.util.HashSet<String> seen, int depth) {
        if (depth > 1) return;
        java.io.File[] files;
        try { files = dir.listFiles(); } catch (Throwable t) { return; }
        if (files == null) return;
        try { java.util.Arrays.sort(files); } catch (Throwable ignored) {}
        for (java.io.File f : files) {
            try {
                if (f.isDirectory()) { scanDir(f, out, seen, depth + 1); continue; }
                String name = f.getName();
                if (name == null || !name.toLowerCase(java.util.Locale.ROOT).endsWith(".gguf")) continue;
                String path = f.getAbsolutePath();
                if (seen.contains(path)) continue;
                seen.add(path);
                JSObject m = new JSObject();
                m.put("path", path);
                m.put("name", name);
                m.put("sizeMB", (int) (f.length() / 1048576));
                out.put(m);
            } catch (Throwable ignored) {}
        }
    }

    /* ============ v9.0 APEX ============ */

    /** Stashed by MainActivity.onNewIntent (added by register_plugin.py) so
     *  warm-start shares reach the web layer. */
    public static Intent pendingShare = null;

    /** Reads and CONSUMES a share-sheet payload (ACTION_SEND text or image). */
    @PluginMethod
    public void getSharedContent(PluginCall call) {
        JSObject r = ok();
        try {
            Intent i = pendingShare != null ? pendingShare : getActivity().getIntent();
            pendingShare = null;
            if (i != null && Intent.ACTION_SEND.equals(i.getAction())) {
                String txt = i.getStringExtra(Intent.EXTRA_TEXT);
                if (txt != null && !txt.isEmpty()) r.put("text", txt);
                Uri stream = i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    try {
                        java.io.InputStream in = getContext().getContentResolver().openInputStream(stream);
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        byte[] buf = new byte[65536]; int n;
                        if (in != null) { while ((n = in.read(buf)) > 0) bos.write(buf, 0, n); in.close(); }
                        byte[] bytes = bos.toByteArray();
                        if (bytes.length <= 8 * 1024 * 1024) {
                            r.put("imageBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                            String mime = getContext().getContentResolver().getType(stream);
                            if (mime != null) r.put("mime", mime);
                        }
                    } catch (Throwable ignored) {}
                }
                try { getActivity().setIntent(new Intent(Intent.ACTION_MAIN)); } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
        call.resolve(r);
    }

    /** Set the home/lock-screen wallpaper from a base64 image (A1 Forge). */
    @PluginMethod
    public void setWallpaper(PluginCall call) {
        String b64 = call.getString("base64", "");
        if (b64.isEmpty()) { call.resolve(fail("empty")); return; }
        try {
            if (b64.startsWith("data:")) b64 = b64.substring(b64.indexOf(',') + 1);
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) { call.resolve(fail("bad_image")); return; }
            android.app.WallpaperManager.getInstance(getContext()).setBitmap(bmp);
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /** Notification history ring (A3: history, digest, deleted keeper). */
    @PluginMethod
    public void getNotifLog(PluginCall call) {
        if (!FridayAssistantSpeech.canDisplayPrivateContent(getContext())) {
            call.resolve(fail("private_or_locked")); return;
        }
        String app = call.getString("app", "");
        int limit = Math.max(1, Math.min(200, call.getInt("limit", 40)));
        org.json.JSONArray raw = FridayNotificationService.readLog(getContext(), app, limit);
        JSArray items = new JSArray();
        for (int i = 0; i < raw.length(); i++) {
            org.json.JSONObject o = raw.optJSONObject(i);
            if (o == null) continue;
            JSObject m = new JSObject();
            m.put("key", o.optString("key", ""));
            m.put("pkg", o.optString("pkg", ""));
            m.put("title", o.optString("title", ""));
            m.put("text", o.optString("text", ""));
            m.put("category", o.optString("category", "OTHER"));
            m.put("sensitive", o.optBoolean("sensitive", false));
            m.put("replyable", o.optBoolean("replyable", false));
            m.put("when", o.optLong("when", 0));
            items.put(m);
        }
        JSObject r = ok(); r.put("items", items); r.put("count", items.length());
        call.resolve(r);
    }

    /** Package of the app currently in the foreground (A4 scroll police). */
    @PluginMethod
    public void getForegroundApp(PluginCall call) {
        JSObject r = ok();
        r.put("pkg", FridayAccessibility.foregroundPkg());
        call.resolve(r);
    }

    /* ============ CAPABILITIES ============ */
    @PluginMethod
    public void capabilities(PluginCall call) {
        Context ctx = getContext();
        JSObject r = ok();
        r.put("contacts", granted(Manifest.permission.READ_CONTACTS));
        r.put("sms", granted(Manifest.permission.READ_SMS));
        r.put("sendSms", granted(Manifest.permission.SEND_SMS));
        r.put("phone", granted(Manifest.permission.CALL_PHONE));
        r.put("apps", true);
        r.put("toggles", true);
        r.put("background", true);
        try {
            r.put("overlay", Settings.canDrawOverlays(ctx));
            String nl = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
            r.put("notifications", nl != null && nl.contains(ctx.getPackageName()));
            String acc = Settings.Secure.getString(ctx.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            r.put("accessibility", acc != null && acc.contains(ctx.getPackageName()));
        } catch (Exception ignored) {}
        call.resolve(r);
    }

    /* ============ QUICK SETTINGS TILE ============ */
    /** One-shot flag the QS tile drops before launching the app. */
    @PluginMethod
    public void consumeTileRequest(PluginCall call) {
        try {
            SharedPreferences p = getContext().getSharedPreferences(
                    FridayTileService.PREFS, Context.MODE_PRIVATE);
            long at = p.getLong(FridayTileService.KEY_LISTEN, 0);
            p.edit().remove(FridayTileService.KEY_LISTEN).apply();
            JSObject r = ok();
            r.put("listen", at > 0 && System.currentTimeMillis() - at < 5 * 60 * 1000);
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ HOME-SCREEN WIDGET ============ */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        try {
            FridayWidgetProvider.push(getContext(),
                    call.getString("text", ""), call.getString("meta", ""));
            call.resolve(ok());
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    /* ============ GEOFENCING (Play services via reflection) ============ */
    /* Native hardware geofencing without a compile-time GMS dependency: all
       play-services classes are reached with Class.forName, so a build without
       the location library still compiles and simply resolves gms_missing.
       The JS-side GPS fallback (automation.js) keeps working in that case. */

    private PendingIntent geofenceIntent() {
        Intent i = new Intent(getContext(), FridayGeofenceReceiver.class);
        i.setAction(FridayGeofenceReceiver.ACTION);
        return PendingIntent.getBroadcast(getContext(), 7717, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Object buildGeofence(String id, double lat, double lon, float radius) throws Exception {
        Class<?> gCls = Class.forName("com.google.android.gms.location.Geofence");
        Class<?> bCls = Class.forName("com.google.android.gms.location.Geofence$Builder");
        Object b = bCls.getDeclaredConstructor().newInstance();
        bCls.getMethod("setRequestId", String.class).invoke(b, id);
        bCls.getMethod("setCircularRegion", double.class, double.class, float.class)
            .invoke(b, lat, lon, radius);
        bCls.getMethod("setExpirationDuration", long.class).invoke(b, -1L);  // NEVER_EXPIRE
        int enter = gCls.getField("GEOFENCE_TRANSITION_ENTER").getInt(null);
        int exit = gCls.getField("GEOFENCE_TRANSITION_EXIT").getInt(null);
        bCls.getMethod("setTransitionTypes", int.class).invoke(b, enter | exit);
        return bCls.getMethod("build").invoke(b);
    }

    private void addFencesInternal(List<Object> list, final PluginCall call) throws Exception {
        Class<?> lsCls = Class.forName("com.google.android.gms.location.LocationServices");
        Object client = lsCls.getMethod("getGeofencingClient", Context.class)
                             .invoke(null, getContext());
        if (list.isEmpty()) {
            Object task = client.getClass()
                    .getMethod("removeGeofences", PendingIntent.class)
                    .invoke(client, geofenceIntent());
            attachTaskListeners(task, call, "geofence_clear_failed");
            return;
        }
        Class<?> reqCls = Class.forName("com.google.android.gms.location.GeofencingRequest");
        Class<?> reqBCls = Class.forName("com.google.android.gms.location.GeofencingRequest$Builder");
        Object rb = reqBCls.getDeclaredConstructor().newInstance();
        int trig = reqCls.getField("INITIAL_TRIGGER_ENTER").getInt(null);
        reqBCls.getMethod("setInitialTrigger", int.class).invoke(rb, trig);
        reqBCls.getMethod("addGeofences", List.class).invoke(rb, list);
        Object req = reqBCls.getMethod("build").invoke(rb);
        Object task = client.getClass()
                .getMethod("addGeofences", reqCls, PendingIntent.class)
                .invoke(client, req, geofenceIntent());
        attachTaskListeners(task, call, "geofence_add_failed");
    }

    private void attachTaskListeners(Object task, final PluginCall call, final String failReason)
            throws Exception {
        Class<?> okCls = Class.forName("com.google.android.gms.tasks.OnSuccessListener");
        Class<?> failCls = Class.forName("com.google.android.gms.tasks.OnFailureListener");
        final boolean[] done = { false };
        InvocationHandler h = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args) {
                if (!done[0]) {
                    done[0] = true;
                    call.resolve(ok());
                }
                return null;
            }
        };
        Object onOk = Proxy.newProxyInstance(okCls.getClassLoader(), new Class<?>[] { okCls }, h);
        Object onFail = Proxy.newProxyInstance(failCls.getClassLoader(), new Class<?>[] { failCls },
            new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) {
                    if (!done[0]) {
                        done[0] = true;
                        call.resolve(fail(failReason));
                    }
                    return null;
                }
            });
        task.getClass().getMethod("addOnSuccessListener", okCls).invoke(task, onOk);
        task.getClass().getMethod("addOnFailureListener", failCls).invoke(task, onFail);
    }

    /** Replace ALL native geofences with the app's current list. */
    @PluginMethod
    public void syncGeofences(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)
                && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            call.resolve(fail("no_location"));
            return;
        }
        try {
            List<Object> list = new ArrayList<>();
            JSONObject names = new JSONObject();
            JSArray fences = call.getArray("fences");
            if (fences != null) {
                for (int i = 0; i < fences.length(); i++) {
                    JSONObject f = (JSONObject) fences.get(i);
                    if (f == null) continue;
                    String id = f.optString("id");
                    double lat = f.optDouble("lat", Double.NaN);
                    double lon = f.optDouble("lon", Double.NaN);
                    if (id.isEmpty() || Double.isNaN(lat) || Double.isNaN(lon)) continue;
                    float radius = (float) f.optDouble("radius", 250);
                    list.add(buildGeofence(id, lat, lon, Math.max(150f, radius)));
                    names.put(id, f.optString("name", id));
                    if (list.size() >= 90) break;   // GMS hard cap is 100/app
                }
            }
            getContext().getSharedPreferences(FridayGeofenceReceiver.PREFS, Context.MODE_PRIVATE)
                .edit().putString("map", names.toString()).apply();
            addFencesInternal(list, call);
        } catch (ClassNotFoundException e) {
            call.resolve(fail("gms_missing"));
        } catch (SecurityException e) {
            call.resolve(fail("no_location"));
        } catch (Exception e) {
            call.resolve(fail(e.getMessage() != null ? e.getMessage() : "error"));
        }
    }

    /** Append one fence (created moments ago) without disturbing the rest. */
    @PluginMethod
    public void addGeofence(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)
                && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            call.resolve(fail("no_location"));
            return;
        }
        try {
            String id = call.getString("id", "");
            Double lat = call.getDouble("lat");
            Double lon = call.getDouble("lon");
            if (id.isEmpty() || lat == null || lon == null) {
                call.resolve(fail("bad_args"));
                return;
            }
            double radiusD = radiusOf(call);
            List<Object> one = new ArrayList<>();
            one.add(buildGeofence(id, lat, lon, Math.max(150f, (float) radiusD)));

            SharedPreferences p = getContext().getSharedPreferences(
                    FridayGeofenceReceiver.PREFS, Context.MODE_PRIVATE);
            JSONObject names = new JSONObject(p.getString("map", "{}"));
            names.put(id, call.getString("name", id));
            p.edit().putString("map", names.toString()).apply();

            addFencesInternal(one, call);
        } catch (ClassNotFoundException e) {
            call.resolve(fail("gms_missing"));
        } catch (SecurityException e) {
            call.resolve(fail("no_location"));
        } catch (Exception e) {
            call.resolve(fail(e.getMessage() != null ? e.getMessage() : "error"));
        }
    }

    private double radiusOf(PluginCall call) {
        try {
            Double d = call.getDouble("radius");
            return d != null ? d : 250.0;
        } catch (Exception e) { return 250.0; }
    }

    /* ============ NOTIFICATION REPLY (RemoteInput) ============ */
    private static String cleanReplyField(String value, int max) {
        if (value == null) return "";
        String cleaned = value.replaceAll("[\\p{Cntrl}]+", " ").replaceAll("\\s+", " ").trim();
        return max > 0 && cleaned.length() > max ? cleaned.substring(0, max) : cleaned;
    }

    /** Mint a short-lived native capability only after an explicit confirmation.
        It is bound to one live event key, exact package, recipient and reply text. */
    @PluginMethod
    public void authorizeNotificationReply(PluginCall call) {
        String eventKey = cleanReplyField(call.getString("eventKey", ""), 512);
        String app = cleanReplyField(call.getString("app", ""), 256);
        String recipient = cleanReplyField(call.getString("recipient", ""), 160);
        String text = cleanReplyField(call.getString("text", ""), 0);
        String confirmation = cleanReplyField(call.getString("confirmation", ""), 40)
                .toLowerCase(java.util.Locale.ROOT);
        if (eventKey.isEmpty() || app.isEmpty() || recipient.isEmpty() || text.isEmpty()) {
            call.resolve(fail("bad_args")); return;
        }
        if (text.length() > 1200) { call.resolve(fail("reply_too_long")); return; }
        if (!confirmation.matches("^(send it|send now|bhejo|haan bhejo|ab bhejo)$")) {
            call.resolve(fail("explicit_confirmation_required")); return;
        }
        if (!FridayAssistantSpeech.canReveal(getContext())) {
            call.resolve(fail("private_or_locked")); return;
        }
        if (!FridayNotificationService.isEnabled()) {
            call.resolve(fail("no_listener")); return;
        }
        if (!FridayNotificationService.matchesReplyTarget(eventKey, app, recipient)) {
            call.resolve(fail("reply_target_changed")); return;
        }
        long now = System.currentTimeMillis();
        for (Map.Entry<String, ReplyAuthorization> entry : REPLY_AUTHORIZATIONS.entrySet()) {
            if (entry.getValue().expiresAt < now) REPLY_AUTHORIZATIONS.remove(entry.getKey(), entry.getValue());
        }
        /* Bound in-memory capabilities even if a compromised WebView repeatedly
           requests valid-looking drafts during the two-minute validity window. */
        if (REPLY_AUTHORIZATIONS.size() >= 64) {
            call.resolve(fail("too_many_pending_authorizations"));
            return;
        }
        String token = UUID.randomUUID().toString();
        REPLY_AUTHORIZATIONS.put(token,
                new ReplyAuthorization(eventKey, app, recipient, text, now + REPLY_AUTH_TTL_MS));
        JSObject result = ok();
        result.put("authorizationToken", token);
        result.put("expiresAt", now + REPLY_AUTH_TTL_MS);
        call.resolve(result);
    }

    /** Answers a real notification through its own quick-reply action. The native
        capability is removed before the attempt, so success and failure are one-use. */
    @PluginMethod
    public void replyNotification(PluginCall call) {
        String token = call.getString("authorizationToken", "");
        String eventKey = cleanReplyField(call.getString("eventKey", ""), 512);
        String app = cleanReplyField(call.getString("app", ""), 256);
        String text = cleanReplyField(call.getString("text", ""), 0);
        ReplyAuthorization authorization = token.isEmpty() ? null : REPLY_AUTHORIZATIONS.remove(token);
        if (authorization == null) { call.resolve(fail("authorization_required")); return; }
        long now = System.currentTimeMillis();
        if (now > authorization.expiresAt) { call.resolve(fail("authorization_expired")); return; }
        if (!authorization.eventKey.equals(eventKey) || !authorization.app.equals(app)
                || !authorization.text.equals(text)) {
            call.resolve(fail("authorization_mismatch")); return;
        }
        /* Re-check every volatile condition at the actual native send boundary. */
        if (!FridayAssistantSpeech.canReveal(getContext())) {
            call.resolve(fail("private_or_locked")); return;
        }
        if (!FridayNotificationService.isEnabled()) {
            call.resolve(fail("no_listener")); return;
        }
        if (!FridayNotificationService.matchesReplyTarget(
                authorization.eventKey, authorization.app, authorization.recipient)) {
            call.resolve(fail("reply_target_changed")); return;
        }
        try {
            boolean sent = FridayNotificationService.reply(getContext(), eventKey, app, text);
            if (sent) {
                JSObject r = ok(); r.put("app", app); r.put("eventKey", eventKey); call.resolve(r);
            } else {
                JSObject r = fail("not_found");
                r.put("reason", "The exact notification nnot_reply"); r.put("reason", e.getMessage()); call.resolve(r);
        }
    }

    /* ============ STEP 5: ALWAYS-ON ASSISTANT + DURABLE REMINDERS ============ */
    @PluginMethod
    public void configureAssistant(PluginCall call) {
        SharedPreferences.Editor edit = getContext()
                .getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE).edit();
        edit.putBoolean("proactive_enabled", call.getBoolean("enabled", false));
        edit.putBoolean("notifications_enabled", call.getBoolean("notificationsEnabled", true));
        edit.putBoolean("private_mode", call.getBoolean("privateMode", false));
        edit.putBoolean("private_on_lock", call.getBoolean("privateOnLock", true));
        edit.putBoolean("quiet_enabled", call.getBoolean("quietEnabled", true));
        edit.putInt("quiet_start", Math.max(0, Math.min(1439, call.getInt("quietStart", 22 * 60))));
        edit.putInt("quiet_end", Math.max(0, Math.min(1439, call.getInt("quietEnd", 7 * 60))));
        edit.putInt("rate_limit_seconds", Math.max(5, Math.min(3600,
                call.getInt("rateLimitSeconds", 20))));
        edit.putInt("max_per_hour", Math.max(1, Math.min(60, call.getInt("maxPerHour", 12))));
        edit.putString("address", FridayAssistantPolicy.boundedText(
                call.getString("address", "Boss"), 40));
        String requestedCategories = "," + call.getString("categories",
                "MESSAGE,EMAIL,CALENDAR,DELIVERY,MISSED_CALL,SENSITIVE") + ",";
        StringBuilder acceptedCategories = new StringBuilder();
        for (FridayAssistantPolicy.Category category : FridayAssistantPolicy.Category.values()) {
            if (category == FridayAssistantPolicy.Category.OTHER
                    || category == FridayAssistantPolicy.Category.SYSTEM) continue;
            if (requestedCategories.contains("," + category.name() + ",")) {
                if (acceptedCategories.length() > 0) acceptedCategories.append(',');
                acceptedCategories.append(category.name());
            }
        }
        edit.putString("categories", acceptedCategories.toString());
        edit.putString("blocked_packages", FridayAssistantPolicy.boundedText(
                call.getString("blockedPackages", ""), 4000));
        edit.putString("blocked_contacts", FridayAssistantPolicy.boundedText(
                call.getString("blockedContacts", ""), 4000));
        edit.putBoolean("call_announcements", call.getBoolean("callAnnouncements", true));
        boolean persisted = edit.commit();
        boolean enabled = call.getBoolean("enabled", false);
        if (!persisted) {
            call.resolve(fail("assistant_settings_persist_failed"));
            return;
        }
        boolean privateMode = call.getBoolean("privateMode", false);
        if (!enabled || privateMode) FridayAssistantSpeech.silence();
        if (enabled) FridayAssistantSpeech.initialize(getContext());
        FridayService.refreshNotificationIfRunning(getContext());
        JSObject r = ok(); r.put("enabled", enabled); call.resolve(r);
    }

    @PluginMethod
    public void getAssistantStatus(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE);
        JSObject r = ok();
        r.put("enabled", p.getBoolean("proactive_enabled", false));
        r.put("privateMode", p.getBoolean("private_mode", false));
        r.put("privateOnLock", p.getBoolean("private_on_lock", true));
        r.put("quietNow", FridayAssistantSpeech.isQuietNow(p));
        if (FridayAssistantSpeech.canDisplayPrivateContent(getContext())) {
            r.put("reminders", FridayReminderScheduler.list(getContext()));
        } else {
            r.put("reminders", new JSONArray());
            r.put("remindersWithheld", true);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void consumeAssistantEvent(PluginCall call) {
        if (!FridayAssistantSpeech.canDisplayPrivateContent(getContext())) {
            call.resolve(fail("private_or_locked"));
            return;
        }
        SharedPreferences p = getContext().getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE);
        String raw = p.getString("pending_event", "");
        p.edit().remove("pending_event").apply();
        JSObject r = ok();
        if (!raw.isEmpty()) {
            try { r.put("event", new JSONObject(raw)); } catch (Exception ignored) {}
        }
        call.resolve(r);
    }

    @PluginMethod
    public void scheduleAssistantReminder(PluginCall call) {
        try {
            JSONObject item = FridayReminderScheduler.schedule(getContext(),
                    call.getString("id", ""), call.getString("text", ""), call.getLong("dueAt", 0L),
                    call.getString("actionType", ""), call.getString("target", ""), call.getString("message", ""));
            JSObject r = ok(); r.put("item", item); call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    @PluginMethod
    public void cancelAssistantReminder(PluginCall call) {
        boolean cancelled = FridayReminderScheduler.cancel(getContext(), call.getString("id", ""));
        call.resolve(cancelled ? ok() : fail("not_found_or_persist_failed"));
    }

    @PluginMethod
    public void restoreAssistantReminders(PluginCall call) {
        FridayReminderScheduler.rescheduleAll(getContext());
        JSObject r = ok(); r.put("items", FridayReminderScheduler.list(getContext())); call.resolve(r);
    }

    /* ============ v10.3 HERALD: CALL GUARD ============ */
    /** Settings -> Call Guard group writes this plugin-side; the
        FridayCallGuard receiver reads it even when the app is dead. */
    @PluginMethod
    public void setCallGuard(PluginCall call) {
        final Boolean en = call.getBoolean("enabled");
        final boolean enabled = en != null && en;
        final String template = call.getString("template", "");
        final String mode = call.getString("mode", "sms");
        if (!FridayCallGuard.configure(getContext(), enabled, template, mode)) {
            call.resolve(fail("call_guard_settings_persist_failed"));
            return;
        }
        JSObject r = ok();
        r.put("enabled", enabled);
        call.resolve(r);
    }

    @PluginMethod
    public void getCallGuard(PluginCall call) {
        android.content.SharedPreferences sp = getContext().getSharedPreferences(FridayCallGuard.PREFS, Context.MODE_PRIVATE);
        JSObject r = ok();
        r.put("enabled", sp.getBoolean("enabled", false));
        r.put("template", sp.getString("template", ""));
        r.put("mode", sp.getString("mode", "sms"));
        call.resolve(r);
    }

    @PluginMethod
    public void getCallGuardLog(PluginCall call) {
        if (!FridayAssistantSpeech.canDisplayPrivateContent(getContext())) {
            call.resolve(fail("private_or_locked")); return;
        }
        JSObject r = ok();
        try { r.put("items", FridayCallGuard.readLog(getContext())); } catch (Exception ignored) {}
        call.resolve(r);
    }

    /** Called by FridayCallGuard after it answers/declines — the app (if
        alive) announces it: "Ramesh ko FRIDAY ne sambhala, SMS bhej diya". */
    public static void emitCallHandled(String number, String action) {
        FridayNative p = activePlugin;
        if (p == null) return;
        try {
            JSObject o = new JSObject();
            String safeNumber = FridayAssistantSpeech.canReveal(p.getContext())
                    ? number : "private caller";
            o.put("number", safeNumber);
            o.put("action", action);
            p.notifyListeners(FridayCallGuard.EVT, o);
        } catch (Exception ignored) {}
    }

    /* ============ ACCESSIBILITY v2 (tap / scroll / type) ============ */
    @PluginMethod
    public void tapText(PluginCall call) {
        String t = call.getString("text", "");
        if (t.isEmpty()) { call.resolve(fail("empty")); return; }
        boolean done = FridayAccessibility.tapText(t);
        call.resolve(done ? ok()
                : fail(FridayAccessibility.isEnabled() ? "not_found" : "accessibility_off"));
    }

    @PluginMethod
    public void scrollScreen(PluginCall call) {
        String dir = call.getString("dir", "down");
        boolean done = FridayAccessibility.scrollScreen(dir);
        call.resolve(done ? ok()
                : fail(FridayAccessibility.isEnabled() ? "not_scrollable" : "accessibility_off"));
    }

    @PluginMethod
    public void typeText(PluginCall call) {
        String t = call.getString("text", "");
        boolean done = FridayAccessibility.typeText(t);
        call.resolve(done ? ok()
                : fail(FridayAccessibility.isEnabled() ? "no_input_focused" : "accessibility_off"));
    }

    /* ============ SECURITY GUARD ============ */
    /** Called by FridaySecurityReceiver when a non-Play app appears. */
    public static void emitSecurityAlert(String pkg, String label, String source) {
        FridayNative p = activePlugin;
        if (p == null) return;
        try {
            JSObject o = new JSObject();
            o.put("pkg", pkg);
            o.put("label", label);
            o.put("source", source);
            p.notifyListeners("securityAlert", o);
        } catch (Exception ignored) {}
    }

    /** Full on-device security audit. No network, no root - just the facts
        the OS already knows, explained in plain language by the JS layer. */
    @PluginMethod
    public void securityAudit(PluginCall call) {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        JSObject r = ok();
        JSONArray sideloaded = new JSONArray();
        JSONArray admins = new JSONArray();
        try {
            List<ApplicationInfo> apps = pm.getInstalledApplications(0);
            for (ApplicationInfo ai : apps) {
                if (ai == null) continue;
                if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue;   // ROM apps skip
                String installer = null;
                try {
                    if (Build.VERSION.SDK_INT >= 30) {
                        installer = pm.getInstallSourceInfo(ai.packageName).getInstallingPackageName();
                    } else {
                        installer = pm.getInstallerPackageName(ai.packageName);
                    }
                } catch (Exception ignored) {}
                if (installer == null || !"com.android.vending".equals(installer)) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("pkg", ai.packageName);
                        o.put("name", String.valueOf(pm.getApplicationLabel(ai)));
                        o.put("installer", installer == null ? "unknown/adb" : installer);
                        sideloaded.put(o);
                    } catch (Exception ignored) {}
                }
            }
            android.app.admin.DevicePolicyManager dpm =
                    (android.app.admin.DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            List<ComponentName> active = dpm.getActiveAdmins();
            if (active != null) {
                for (ComponentName c : active) {
                    if (c != null) admins.put(c.getPackageName());
                }
            }
        } catch (Exception ignored) {}
        try {
            String acc = Settings.Secure.getString(ctx.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            String nl = Settings.Secure.getString(ctx.getContentResolver(),
                    "enabled_notification_listeners");
            r.put("accessibilityServices", acc == null ? "" : acc);
            r.put("notifListeners", nl == null ? "" : nl);
            r.put("adbEnabled", Settings.Global.getInt(
                    ctx.getContentResolver(), Settings.Global.ADB_ENABLED, 0) == 1);
            r.put("devSettings", Settings.Global.getInt(
                    ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1);
            android.app.KeyguardManager kg =
                    (android.app.KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
            r.put("lockScreenSet", kg != null && kg.isDeviceSecure());
        } catch (Exception ignored) {}
        r.put("sideloaded", sideloaded);
        r.put("deviceAdmins", admins);
        call.resolve(r);
    }

    /* ============ NETWORK RECON (own network only) ============ */

    /** WiFi security audit: SSID, encryption type, gateway, link quality. */
    @PluginMethod
    public void wifiAudit(PluginCall call) {
        try {
            Context ctx = getContext();
            WifiManager wm = (WifiManager) ctx.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            android.net.wifi.WifiInfo info = wm.getConnectionInfo();
            if (info == null || info.getNetworkId() == -1) { call.resolve(fail("not_connected")); return; }

            JSObject r = ok();
            String ssid = info.getSSID();
            if (ssid != null && ssid.startsWith("\"") && ssid.endsWith("\"")) {
                ssid = ssid.substring(1, ssid.length() - 1);
            }
            if (ssid == null || ssid.equals("<unknown ssid>")) ssid = "";
            r.put("ssid", ssid);
            r.put("bssid", info.getBSSID());
            r.put("rssi", info.getRssi());

            /* encryption type (API 31+ direct; older: capabilities string) */
            String sec = "unknown";
            if (Build.VERSION.SDK_INT >= 31) {
                int st = info.getCurrentSecurityType();
                sec = st == android.net.wifi.WifiInfo.SECURITY_TYPE_OPEN ? "open"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_WEP ? "wep"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_PSK ? "wpa/wpa2-personal"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_SAE ? "wpa3-personal"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_EAP ? "wpa-enterprise"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_EAP_WPA3_ENTERPRISE ? "wpa3-enterprise"
                    : st == android.net.wifi.WifiInfo.SECURITY_TYPE_OWE ? "owe (enhanced open)"
                    : "unknown";
            } else {
                sec = "check router (older Android)";
            }
            r.put("security", sec);

            android.net.DhcpInfo dhcp = wm.getDhcpInfo();
            if (dhcp != null) {
                r.put("gateway", ipToString(dhcp.gateway));
                r.put("ip", ipToString(dhcp.ipAddress));
                r.put("dns1", ipToString(dhcp.dns1));
                r.put("dns2", ipToString(dhcp.dns2));
            }
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
    }

    private String ipToString(int ip) {
        return (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + "." + ((ip >> 24) & 0xff);
    }

    /** LAN sweep: /proc/net/arp first, then ping the subnet. Read-only, own
        network only. Resolves {ok, gateway, self, hosts:[{ip,mac}]}. */
    @PluginMethod
    public void lanScan(PluginCall call) {
        new Thread(() -> {
            try {
                Context ctx = getContext();
                WifiManager wm = (WifiManager) ctx.getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                android.net.DhcpInfo dhcp = wm.getDhcpInfo();
                if (dhcp == null || dhcp.ipAddress == 0) { call.resolve(fail("not_connected")); return; }

                String self = ipToString(dhcp.ipAddress);
                String gateway = ipToString(dhcp.gateway);

                /* subnet guessed from own IP (/24) */
                String prefix = self.substring(0, self.lastIndexOf('.') + 1);

                java.util.Map<String, String> hosts = new java.util.LinkedHashMap<>();

                /* 1) ARP cache (instant, silent) */
                try {
                    java.io.BufferedReader br = new java.io.BufferedReader(
                            new java.io.FileReader("/proc/net/arp"));
                    String line;
                    while ((line = br.readLine()) != null) {
                        String[] parts = line.split("\\s+");
                        if (parts.length >= 4 && parts[0].startsWith(prefix)
                                && !"00:00:00:00:00:00".equals(parts[3])) {
                            hosts.put(parts[0], parts[3]);
                        }
                    }
                    br.close();
                } catch (Exception ignored) {}

                /* 2) ping sweep of the /24 (icmp where allowed, else TCP:80/443/1900/8080 touch) */
                List<String> order = new ArrayList<>();
                for (int i = 1; i < 255; i++) order.add(prefix + i);
                final List<Object[]> found = java.util.Collections.synchronizedList(new ArrayList<>());
                java.util.concurrent.ExecutorService pool =
                        java.util.concurrent.Executors.newFixedThreadPool(24);
                final java.util.concurrent.CountDownLatch done =
                        new java.util.concurrent.CountDownLatch(order.size());
                for (final String ip : order) {
                    pool.execute(() -> {
                        try {
                            boolean up = java.net.InetAddress.getByName(ip).isReachable(400);
                            if (!up) {
                                String[] tryPorts = {"80", "443", "1900", "8080", "53", "445"};
                                for (String p : tryPorts) {
                                    try (java.net.Socket s = new java.net.Socket()) {
                                        s.connect(new java.net.InetSocketAddress(ip, Integer.parseInt(p)), 220);
                                        up = true;
                                        break;
                                    } catch (Exception ignored) {}
                                    if (up) break;
                                }
                            }
                            if (up && !hosts.containsKey(ip)) found.add(new Object[]{ip, null});
                        } catch (Exception ignored) {
                        } finally {
                            done.countDown();
                        }
                    });
                }
                done.await(20, java.util.concurrent.TimeUnit.SECONDS);
                pool.shutdown();
                for (Object[] f : found) hosts.put((String) f[0], "");

                /* merge: self + gateway always */
                if (!hosts.containsKey(self)) hosts.put(self, "");
                if (gateway != null && !gateway.isEmpty() && !hosts.containsKey(gateway)) {
                    hosts.put(gateway, "");
                }

                JSArray arr = new JSArray();
                int n = 0;
                for (java.util.Map.Entry<String, String> e : hosts.entrySet()) {
                    if (n++ > 60) break;
                    JSObject o = new JSObject();
                    o.put("ip", e.getKey());
                    o.put("mac", e.getValue());
                    o.put("isSelf", e.getKey().equals(self));
                    o.put("isGateway", e.getKey().equals(gateway));
                    arr.put(o);
                }
                JSObject r = ok();
                r.put("gateway", gateway);
                r.put("self", self);
                r.put("hosts", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.resolve(fail(e.getMessage()));
            }
        }).start();
    }

    /** TCP connect scan of one host on the ports that actually matter.
        {ok, host, open:[23,80,...]} */
    @PluginMethod
    public void portScan(PluginCall call) {
        final String host = call.getString("host", "");
        if (host.isEmpty()) { call.resolve(fail("no_host")); return; }
        new Thread(() -> {
            try {
                int[] ports = {21,22,23,53,80,111,135,139,445,554,631,1723,1900,
                               2323,3306,5000,5353,5900,7547,8080,8291,8443,9100};
                final JSArray open = new JSArray();
                java.util.concurrent.ExecutorService pool =
                        java.util.concurrent.Executors.newFixedThreadPool(16);
                final java.util.concurrent.CountDownLatch done =
                        new java.util.concurrent.CountDownLatch(ports.length);
                for (final int p : ports) {
                    pool.execute(() -> {
                        try (java.net.Socket s = new java.net.Socket()) {
                            s.connect(new java.net.InetSocketAddress(host, p), 350);
                            synchronized (open) { open.put(p); }
                        } catch (Exception ignored) {
                        } finally {
                            done.countDown();
                        }
                    });
                }
                done.await(15, java.util.concurrent.TimeUnit.SECONDS);
                pool.shutdown();
                JSObject r = ok();
                r.put("host", host);
                r.put("open", open);
                call.resolve(r);
            } catch (Exception e) {
                call.resolve(fail(e.getMessage()));
            }
        }).start();
    }

    /* The old in-Activity Hugging Face downloader was intentionally disabled:
       it could be killed with the Activity and published partial files. All
       callers now use FridayDownloads + foreground WorkManager persistence. */
    @Deprecated
    @PluginMethod
    public void hfDownload(final PluginCall call) {
        call.resolve(fail("moved_to_persistent_downloader"));
    }
}