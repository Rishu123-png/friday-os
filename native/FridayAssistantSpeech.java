package com.rishu.fridayos;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;

import java.util.Calendar;
import java.util.Locale;

/** Process-owned TTS that receivers/services can use after the Activity closes. */
public final class FridayAssistantSpeech {
    public static final String PREFS = "friday_assistant";
    private static final Object LOCK = new Object();
    private static TextToSpeech tts;
    private static boolean ready;
    private static String queued;
    private static boolean queuedUrgent;

    private FridayAssistantSpeech() {}

    public static void initialize(Context context) {
        ensure(context.getApplicationContext(), null, false);
    }

    public static void speak(Context context, String text, boolean urgent) {
        if (text == null || text.trim().isEmpty()) return;
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("proactive_enabled", false)) return;
        if (prefs.getBoolean("private_mode", false)) return;
        if (!urgent && (isQuietNow(prefs) || dndBlocks(app))) return;
        ensure(app, FridayAssistantPolicy.safeText(text, 600), urgent);
    }

    /** Immediately stop queued/current proactive speech when Pause or Private is enabled. */
    public static void silence() {
        synchronized (LOCK) {
            queued = null;
            if (tts != null) {
                try { tts.stop(); } catch (Exception ignored) {}
            }
        }
    }

    public static boolean canReveal(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("private_mode", false)) return false;
        if (!prefs.getBoolean("private_on_lock", true)) return true;
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && (!km.isDeviceLocked() || hasPrivateAudio(context));
    }

    /** Headphones can privatize speech, never pixels or WebView data. */
    public static boolean canDisplayPrivateContent(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("private_mode", false)) return false;
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && !km.isDeviceLocked();
    }

    public static boolean isQuietNow(SharedPreferences prefs) {
        if (!prefs.getBoolean("quiet_enabled", true)) return false;
        Calendar c = Calendar.getInstance();
        int minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        return FridayAssistantPolicy.isQuietMinute(minute,
                prefs.getInt("quiet_start", 22 * 60), prefs.getInt("quiet_end", 7 * 60));
    }

    private static void ensure(Context app, String text, boolean urgent) {
        synchronized (LOCK) {
            if (ready && tts != null) {
                if (text != null) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "friday-assistant");
                return;
            }
            if (text != null) {
                queued = text;
                queuedUrgent = urgent;
            }
            if (tts != null) return;
            tts = new TextToSpeech(app, status -> {
                synchronized (LOCK) {
                    ready = status == TextToSpeech.SUCCESS;
                    if (ready) {
                        tts.setLanguage(Locale.getDefault());
                        tts.setSpeechRate(0.95f);
                        /* Initialization can take seconds. Re-check every mutable privacy
                           gate before playing text captured while TTS was starting. */
                        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                        boolean allowed = prefs.getBoolean("proactive_enabled", false)
                                && !prefs.getBoolean("private_mode", false)
                                && canReveal(app)
                                && (queuedUrgent || (!isQuietNow(prefs) && !dndBlocks(app)));
                        if (queued != null && allowed) {
                            tts.speak(queued, TextToSpeech.QUEUE_FLUSH, null, "friday-assistant");
                        }
                    }
                    queued = null;
                    queuedUrgent = false;
                }
            });
        }
    }

    private static boolean dndBlocks(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return true;
        if (Build.VERSION.SDK_INT < 23) return false;
        try {
            /* Unsolicited assistant speech stays quiet in Priority, Alarms-only,
               Total Silence, and unknown interruption modes. */
            return nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL;
        } catch (SecurityException ignored) {
            /* If Android will not disclose DND state, fail quiet rather than interrupt. */
            return true;
        }
    }

    private static boolean hasPrivateAudio(Context context) {
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT >= 23) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET
                        || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                        || t == AudioDeviceInfo.TYPE_USB_HEADSET) return true;
            }
        }
        return am.isWiredHeadsetOn() || am.isBluetoothA2dpOn();
    }
}
