package com.rishu.fridayos;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile - pull down the notification shade, tap FRIDAY,
 *  and the app opens straight into voice listening.
 *
 *  The tile itself cannot start speech recognition (background mic is
 *  restricted), so it drops a flag in SharedPreferences and launches the
 *  app; FridayNative.consumeTileRequest() picks it up and calls listen().
 */
public class FridayTileService extends TileService {

    public static final String PREFS = "FridayTile";
    public static final String KEY_LISTEN = "listen_request";

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile t = getQsTile();
        if (t != null) {
            t.setState(Tile.STATE_INACTIVE);
            t.updateTile();
        }
    }

    @Override
    public void onClick() {
        super.onClick();
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putLong(KEY_LISTEN, System.currentTimeMillis()).apply();

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivityAndCollapseCompat(open);
        }
    }

    @SuppressWarnings("deprecation")
    private void startActivityAndCollapseCompat(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                startActivityAndCollapse(pi);
            } else {
                startActivityAndCollapse(intent);
            }
        } catch (Exception e) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {}
        }
    }
}
