package com.rishu.fridayos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Starts FRIDAY's background service when the phone finishes booting. */
public class FridayBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String a = intent.getAction();
        if (!a.equals(Intent.ACTION_BOOT_COMPLETED)
                && !a.equals("android.intent.action.QUICKBOOT_POWERON")) return;

        boolean enabled = ctx.getSharedPreferences("friday", Context.MODE_PRIVATE)
                .getBoolean("boot_start", false);
        if (!enabled) return;

        try {
            Intent svc = new Intent(ctx, FridayService.class);
            svc.putExtra("title", "FRIDAY is ready");
            svc.putExtra("text", "Tap to open");
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc);
            else ctx.startService(svc);
        } catch (Exception ignored) {}
    }
}
