package com.rishu.fridayos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.util.List;

/** Receives Google Play-services geofence transitions.
 *
 *  Both the GeofencingEvent parsing and the name lookup are done WITHOUT any
 *  compile-time GMS dependency (reflection + SharedPreferences map that
 *  FridayNative writes when fences are registered). If anything is missing
 *  at runtime, onReceive simply does nothing.
 *
 *  Two outputs per transition:
 *    1. notifyListeners("geofenceEvent") -> the running web app (routines fire)
 *    2. a heads-up notification / chat message, so it also works with the app closed
 */
public class FridayGeofenceReceiver extends BroadcastReceiver {

    public static final String PREFS = "FridayGeofences";
    public static final String ACTION = "com.rishu.fridayos.GEOFENCE";
    private static final String CHANNEL = "friday_geofence";
    private static final String GMS_EVENT = "com.google.android.gms.location.GeofencingEvent";
    private static final int TRANSITION_EXIT = 2;   // Geofence.GEOFENCE_TRANSITION_EXIT

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (intent == null || !ACTION.equals(intent.getAction())) return;

            Class<?> evCls = Class.forName(GMS_EVENT);
            Object ev = evCls.getMethod("fromIntent", Intent.class).invoke(null, intent);
            if (ev == null) return;
            if (Boolean.TRUE.equals(evCls.getMethod("hasError").invoke(ev))) return;

            int tr = (Integer) evCls.getMethod("getGeofenceTransition").invoke(ev);
            String transition = tr == TRANSITION_EXIT ? "exit" : "enter";

            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject names = new JSONObject(p.getString("map", "{}"));

            List<?> fences = (List<?>) evCls.getMethod("getTriggeringGeofences").invoke(ev);
            if (fences == null || fences.isEmpty()) return;

            StringBuilder sb = new StringBuilder();
            for (Object f : fences) {
                String rid = (String) f.getClass().getMethod("getRequestId").invoke(f);
                String name = names.optString(String.valueOf(rid), String.valueOf(rid));
                if (sb.length() > 0) sb.append(", ");
                sb.append(name);
                FridayNative.emitGeofence(name, transition);   // -> running web app
            }
            postNotification(ctx, sb.toString(), transition);  // -> works app-closed too
        } catch (Exception ignored) {}
    }

    private void postNotification(Context ctx, String name, String transition) {
        try {
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL, "Places & routines", NotificationManager.IMPORTANCE_DEFAULT);
                nm.createNotificationChannel(ch);
            }

            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = null;
            if (launch != null) {
                pi = PendingIntent.getActivity(ctx, 8812, launch,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            }

            String text = "enter".equals(transition)
                    ? ("Arrived at " + name) : ("Left " + name);

            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(ctx, CHANNEL)
                    : new Notification.Builder(ctx);
            b.setSmallIcon(ctx.getApplicationInfo().icon)
             .setContentTitle("FRIDAY")
             .setContentText(text)
             .setAutoCancel(true);
            if (pi != null) b.setContentIntent(pi);

            nm.notify((int) (System.currentTimeMillis() % 200000) + 40000, b.build());
        } catch (Exception ignored) {}
    }
}
