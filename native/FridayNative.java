package com.rishu.fridayos;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
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

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
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
        JSObject o = new JSObject();
        o.put("pkg", pkg);
        o.put("title", title == null ? "" : title);
        o.put("text", text == null ? "" : text);
        o.put("time", System.currentTimeMillis());
        notifyListeners("notificationPosted", o);
    }

    /* ============ FOREGROUND SERVICE ============ */
    @PluginMethod
    public void startForegroundService(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), FridayService.class);
            i.putExtra("title", call.getString("title", "FRIDAY is listening"));
            i.putExtra("text", call.getString("text", "Say \"Hey Friday\""));
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve(ok());
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
        getContext().getSharedPreferences("friday", Context.MODE_PRIVATE)
                .edit().putBoolean("boot_start", on).apply();
        call.resolve(ok());
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
            call.resolve(r);
        } catch (Exception e) { call.resolve(fail(e.getMessage())); }
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
}