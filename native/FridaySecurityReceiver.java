package com.rishu.fridayos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;

/** Install watcher: fires when ANY app is installed on the device.
 *  Apps from the Play Store are ignored. Anything else (sideload, file
 *  manager, ADB, "free game.apk") is flagged instantly - notification +
 *  event into the running app ("securityAlert").
 *
 *  This is the core of the anti-spyware guard: attackers and scam links
 *  get onto a phone by installing something. Play-store apps are vetted;
 *  everything else deserves a loud heads-up.
 */
public class FridaySecurityReceiver extends BroadcastReceiver {

    private static final String PLAY_STORE = "com.android.vending";
    private static final String CHANNEL = "friday_security";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (intent == null || intent.getAction() == null) return;
            if (!Intent.ACTION_PACKAGE_ADDED.equals(intent.getAction())) return;
            if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return;  // update, not new
            if (intent.getData() == null) return;

            String pkg = intent.getData().getSchemeSpecificPart();
            if (pkg == null || pkg.equals(ctx.getPackageName())) return;

            PackageManager pm = ctx.getPackageManager();
            String installer = installerOf(pm, pkg);
            if (PLAY_STORE.equals(installer)) return;    // vetted, ignore

            String label = pkg;
            try {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                label = String.valueOf(pm.getApplicationLabel(ai));
            } catch (Exception ignored) {}

            String source = installer == null ? "unknown source" : installer;
            FridayNative.emitSecurityAlert(pkg, label, source);   // -> running web app
            postNotification(ctx, label, source, pkg);            // -> works app-closed
        } catch (Exception ignored) {}
    }

    private String installerOf(PackageManager pm, String pkg) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                return pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            }
            return pm.getInstallerPackageName(pkg);
        } catch (Exception e) {
            return null;
        }
    }

    private void postNotification(Context ctx, String label, String source, String pkg) {
        try {
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL, "Security alerts", NotificationManager.IMPORTANCE_HIGH);
                nm.createNotificationChannel(ch);
            }

            PendingIntent pi = null;
            try {
                Intent uninstall = new Intent(Intent.ACTION_DELETE);
                uninstall.setData(android.net.Uri.parse("package:" + pkg));
                uninstall.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                pi = PendingIntent.getActivity(ctx, 5531, uninstall,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            } catch (Exception ignored) {}

            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(ctx, CHANNEL)
                    : new Notification.Builder(ctx);
            b.setSmallIcon(ctx.getApplicationInfo().icon)
             .setContentTitle("FRIDAY Security")
             .setContentText(label + " was installed outside the Play Store (via " + source + ")")
             .setStyle(new Notification.BigTextStyle().bigText(
                     label + " was installed outside the Play Store (via " + source + "). " +
                     "If this was not you, uninstall it and run a security scan."))
             .setAutoCancel(true);
            if (pi != null) b.setContentIntent(pi);   // tap -> uninstall dialog directly

            nm.notify((int) (System.currentTimeMillis() % 90000) + 60000, b.build());
        } catch (Exception ignored) {}
    }
}
