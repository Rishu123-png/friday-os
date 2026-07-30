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

/** Keeps FRIDAY alive in the background with a persistent notification,
 *  so wake word / alarms / automations keep running with the screen off.
 *  NOTE: deliberately NO partial wakelock - it drained battery without
 *  improving reliability. The foreground service alone is the supported
 *  way to stay resident; Android manages the rest. */
public class FridayService extends Service {

    public static final String CHANNEL = "friday_core";
    public static final int NOTIF_ID = 7001;

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "FRIDAY Core", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps FRIDAY listening in the background");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra("title") != null
                ? intent.getStringExtra("title") : "FRIDAY is listening";
        String text = intent != null && intent.getStringExtra("text") != null
                ? intent.getStringExtra("text") : "Say \"Hey Friday\"";

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);

        Notification n = b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

        startForeground(NOTIF_ID, n);
        return START_STICKY;   // restart if Android kills us
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
