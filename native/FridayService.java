package com.rishu.fridayos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** Explicitly enabled foreground host for FRIDAY's event-driven runtime.
 *  AlarmManager and NotificationListenerService own their independent events;
 *  this service keeps process-owned speech/security helpers warm without a
 *  wakelock. Android may still stop it, and a manual Force Stop is final until
 *  the user opens FRIDAY again. */
public class FridayService extends Service {

    public static final String CHANNEL = "friday_core";
    public static final int NOTIF_ID = 7001;
    public static final String ACTION_PAUSE = "com.rishu.fridayos.PAUSE_ASSISTANT";
    public static final String ACTION_PRIVATE = "com.rishu.fridayos.TOGGLE_PRIVATE";
    private static volatile boolean running;
    private static volatile boolean foreground;

    public static boolean isForegroundRunning() { return running && foreground; }

    /** Refresh status/action labels after an in-app privacy setting change, but
     * never start an always-on service the user did not already enable. */
    public static void refreshNotificationIfRunning(Context context) {
        if (!running || context == null) return;
        try {
            Intent refresh = new Intent(context, FridayService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(refresh);
            else context.startService(refresh);
        } catch (Throwable ignored) {}
    }

    /* Install-watcher for the security guard. Manifest receivers for
       PACKAGE_ADDED are dead since Android 8 - dynamic registration from
       this running service is the supported way. */
    private FridaySecurityReceiver installWatcher;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        foreground = false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "FRIDAY Core", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps FRIDAY's approved background assistant runtime active");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        registerInstallWatcher();
        if (getSharedPreferences(FridayAssistantSpeech.PREFS, MODE_PRIVATE)
                .getBoolean("proactive_enabled", false)) FridayAssistantSpeech.initialize(this);
    }

    private void registerInstallWatcher() {
        try {
            if (installWatcher != null) return;
            installWatcher = new FridaySecurityReceiver();
            android.content.IntentFilter f =
                    new android.content.IntentFilter(Intent.ACTION_PACKAGE_ADDED);
            f.addDataScheme("package");
            if (Build.VERSION.SDK_INT >= 34) {
                registerReceiver(installWatcher, f, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(installWatcher, f);
            }
        } catch (Throwable ignored) {}   // Throwable: class-verify errors are Errors, not Exceptions
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_PAUSE.equals(intent.getAction())) {
            getSharedPreferences(FridayAssistantSpeech.PREFS, MODE_PRIVATE).edit()
                    .putBoolean("proactive_enabled", false).apply();
            FridayAssistantSpeech.silence();
            try { stopForeground(true); } catch (Throwable ignored) {}
            stopSelf();
            return START_NOT_STICKY;
        }
        android.content.SharedPreferences assistant =
                getSharedPreferences(FridayAssistantSpeech.PREFS, MODE_PRIVATE);
        if (!assistant.getBoolean("proactive_enabled", false)) {
            FridayAssistantSpeech.silence();
            try { stopForeground(true); } catch (Throwable ignored) {}
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_PRIVATE.equals(intent.getAction())) {
            boolean makePrivate = !assistant.getBoolean("private_mode", false);
            assistant.edit().putBoolean("private_mode", makePrivate).apply();
            if (makePrivate) FridayAssistantSpeech.silence();
        }
        boolean privateMode = assistant.getBoolean("private_mode", false);
        String title = intent != null && intent.getStringExtra("title") != null
                ? intent.getStringExtra("title") : "FRIDAY always-on mode";
        String text = intent != null && intent.getStringExtra("text") != null
                ? intent.getStringExtra("text") : "Smart prompts, reminders and call assistance active";
        if (privateMode) text = "Private mode · proactive speech and private details withheld";

        PendingIntent pi = null;
        try {
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) {
                pi = PendingIntent.getActivity(this, 0, open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            }
        } catch (Throwable ignored) {}

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        Notification.Builder publicBuilder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        Notification publicVersion = publicBuilder
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("FRIDAY always-on mode")
                .setContentText("Unlock to view assistant controls")
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build();

        Intent pauseIntent = new Intent(this, FridayService.class).setAction(ACTION_PAUSE);
        PendingIntent pause = PendingIntent.getService(this, 7002, pauseIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent privateIntent = new Intent(this, FridayService.class).setAction(ACTION_PRIVATE);
        PendingIntent privateToggle = PendingIntent.getService(this, 7003, privateIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .addAction(android.R.drawable.ic_media_pause, "Pause", pause)
                .addAction(android.R.drawable.ic_secure,
                        privateMode ? "Private off" : "Private on", privateToggle)
                .build();

        try {
            startForeground(NOTIF_ID, n);
            foreground = true;
        } catch (Throwable t) {
            foreground = false;
            /* Android 14+ throws when an FGS may not run (boot, battery).
               The keep-alive service must NEVER kill the app process. */
            try { stopSelf(); } catch (Throwable ignored) {}
            return START_NOT_STICKY;
        }
        return START_STICKY;   // restart if Android kills us
    }

    @Override
    public void onDestroy() {
        try {
            if (installWatcher != null) unregisterReceiver(installWatcher);
        } catch (Throwable ignored) {}
        installWatcher = null;
        foreground = false;
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
