package com.rishu.fridayos;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;

/** FRIDAY's body sensors, all in one plugin, all optional, all degrade:
 *
 *  1. STEP COUNTER  - hardware step counter (TYPE_STEP_COUNTER, zero battery
 *     cost) with a per-day offset in SharedPreferences so getSteps() always
 *     answers "steps today" even across app restarts. Needs the
 *     ACTIVITY_RECOGNITION runtime permission on Android 10+.
 *     History lives in SharedPreferences "friday_health" as JSON:
 *     {"2026-07-31": 8123, ...} - the home-screen widget reads the same file.
 *
 *  2. SHAKE-TO-TALK - quick double-shake fires "shake" into the WebView
 *     (the app maps it to: wake + start listening).
 *
 *  3. POCKET GUARD  - anti-theft: while armed, sustained phone motion for
 *     ~1s sounds a LOUD alarm (works with the screen off because
 *     FridayService keeps this process alive). Disarm only from the app.
 *
 *  Everything is wrapped so a missing sensor or permission NEVER crashes.
 */
@CapacitorPlugin(name = "FridaySensors")
public class FridaySensors extends Plugin implements SensorEventListener {

    private static final String PREFS = "friday_health";
    private static final String KEY_OFFSET_DATE = "offset_date";
    private static final String KEY_OFFSET_VAL = "offset_val";
    private static final String KEY_HISTORY = "history";

    private SensorManager sm;
    private Sensor steps, accel;
    private static long lastWidgetPush = 0;

    /* ---- shake ---- */
    private boolean shakeOn = false;
    private long lastShakeAt = 0;
    private float shakeGain = 0f;           // smoothed motion energy

    /* ---- pocket guard ---- */
    private static boolean pocketArmed = false;
    private static Ringtone alarm = null;
    private long motionSince = 0;
    private static final float POCKET_TRIGGER = 2.6f;   // m/s^2 away from gravity
    private static final long POCKET_SUSTAIN_MS = 900;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) { JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o; }

    @Override
    public void load() {
        try {
            sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            if (sm != null) {
                steps = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
                accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            }
        } catch (Throwable ignored) {}
    }

    /* ================= STEPS ================= */

    @PluginMethod
    public void startSteps(PluginCall call) {
        try {
            if (sm == null || steps == null) { call.resolve(fail("no_step_sensor")); return; }
            sm.registerListener(this, steps, SensorManager.SENSOR_DELAY_NORMAL);
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        try {
            SharedPreferences p = prefs();
            JSONObject hist = new JSONObject(p.getString(KEY_HISTORY, "{}"));
            int todaySteps = hist.optInt(today(), 0);
            JSObject r = ok();
            r.put("today", todaySteps);
            r.put("sensor", steps != null);
            JSObject days = new JSObject();
            Iterator<String> it = hist.keys();
            while (it.hasNext()) { String k = it.next(); days.put(k, hist.optInt(k, 0)); }
            r.put("days", days);
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    private void onStepCounter(float totalSinceBoot) {
        SharedPreferences p = prefs();
        String today = today();
        String offsetDate = p.getString(KEY_OFFSET_DATE, "");
        long offset = p.getLong(KEY_OFFSET_VAL, -1);
        long counter = (long) totalSinceBoot;

        if (!today.equals(offsetDate) || offset < 0 || counter < offset) {
            // new day (or phone rebooted: counter restarted) -> rebase
            offset = counter;
            p.edit().putString(KEY_OFFSET_DATE, today).putLong(KEY_OFFSET_VAL, offset).apply();
        }
        int todaySteps = (int) Math.max(0, counter - offset);
        try {
            JSONObject hist = new JSONObject(p.getString(KEY_HISTORY, "{}"));
            if (hist.optInt(today, -1) != todaySteps) {
                hist.put(today, todaySteps);
                // keep last 14 days only
                while (hist.length() > 14) {
                    Iterator<String> it = hist.keys();
                    String oldest = null;
                    while (it.hasNext()) { String k = it.next(); if (oldest == null || k.compareTo(oldest) < 0) oldest = k; }
                    if (oldest == null) break;
                    hist.remove(oldest);
                }
                p.edit().putString(KEY_HISTORY, hist.toString()).apply();
                long now = System.currentTimeMillis();
                if (now - lastWidgetPush > 5 * 60000) {   // widget refresh: max every 5 min
                    lastWidgetPush = now;
                    pushStepsToWidget(getContext());
                }
            }
        } catch (Throwable ignored) {}
    }

    /* ================= SHAKE ================= */

    @PluginMethod
    public void setShake(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            if (sm == null || accel == null) { call.resolve(fail("no_accelerometer")); return; }
            if (on) sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME);
            shakeOn = on;
            JSObject r = ok(); r.put("shake", on); call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /* ================= POCKET GUARD ================= */

    @PluginMethod
    public void setPocketGuard(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            if (on && (sm == null || accel == null)) { call.resolve(fail("no_accelerometer")); return; }
            pocketArmed = on;
            motionSince = 0;
            if (on && sm != null && accel != null) {
                sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME);
            }
            JSObject r = ok(); r.put("armed", on); call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    @PluginMethod
    public void stopPocketAlarm(PluginCall call) {
        stopAlarm();
        pocketArmed = false;
        call.resolve(ok());
    }

    private synchronized void fireAlarm() {
        try {
            if (alarm != null && alarm.isPlaying()) return;
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
            }
            alarm = RingtoneManager.getRingtone(getContext(),
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (alarm != null) {
                alarm.setStreamType(AudioManager.STREAM_ALARM);
                alarm.play();
            }
            JSObject o = new JSObject();
            o.put("at", System.currentTimeMillis());
            notifyListeners("pocketAlarm", o);
        } catch (Throwable ignored) {}
    }

    public static void stopAlarm() {
        try { if (alarm != null && alarm.isPlaying()) alarm.stop(); } catch (Throwable ignored) {}
        alarm = null;
        pocketArmed = false;
    }

    /* ================= SENSOR FEED ================= */

    @Override
    public void onSensorChanged(SensorEvent e) {
        try {
            if (e.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
                onStepCounter(e.values[0]);
                return;
            }
            if (e.sensor.getType() != Sensor.TYPE_ACCELEROMETER) return;

            float x = e.values[0], y = e.values[1], z = e.values[2];
            float mag = (float) Math.sqrt(x * x + y * y + z * z);
            float dev = Math.abs(mag - SensorManager.GRAVITY_EARTH);

            /* shake: resonant energy, decays fast; a firm shake pumps it up */
            shakeGain = shakeGain * 0.6f + dev * 0.4f;
            if (shakeOn && shakeGain > 6.5f) {
                long now = System.currentTimeMillis();
                if (now - lastShakeAt > 2500) {
                    lastShakeAt = now;
                    shakeGain = 0f;
                    notifyListeners("shake", new JSObject());
                }
            }

            /* pocket guard: sustained motion while armed */
            if (pocketArmed) {
                long now = System.currentTimeMillis();
                if (dev > POCKET_TRIGGER) {
                    if (motionSince == 0) motionSince = now;
                    if (now - motionSince > POCKET_SUSTAIN_MS) {
                        motionSince = 0;
                        fireAlarm();
                    }
                } else {
                    motionSince = 0;
                }
            }
        } catch (Throwable ignored) {}
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    @Override
    protected void handleOnDestroy() {
        stopAlarm();
        try { if (sm != null) sm.unregisterListener(this); } catch (Throwable ignored) {}
    }

    /* Widget reads these too (same SharedPreferences file). */
    public static void pushStepsToWidget(Context ctx) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject hist = new JSONObject(p.getString(KEY_HISTORY, "{}"));
            FridayWidgetProvider.pushSteps(ctx, hist.optInt(today(), 0));
        } catch (Throwable ignored) {}
    }
}
