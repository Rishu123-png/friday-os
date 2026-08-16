package com.rishu.fridayos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Restores durable reminders and, when explicitly enabled, FRIDAY's service after boot. */
public class FridayBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String a = intent.getAction();
        if (!a.equals(Intent.ACTION_BOOT_COMPLETED)
                && !a.equals("android.intent.action.QUICKBOOT_POWERON")) return;

        FridayReminderScheduler.restoreAfterBoot(ctx);

        boolean enabled = ctx.getSharedPreferences("friday", Context.MODE_PRIVATE)
                .getBoolean("boot_start", false);
        boolean proactive = ctx.getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE)
                .getBoolean("proactive_enabled", false);
        if (!enabled || !proactive) return;

        try {
            Intent svc = new Intent(ctx, FridayService.class);
            svc.putExtra("title", "FRIDAY always-on mode restored");
            svc.putExtra("text", "Smart prompts, reminders and call assistance active");
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc);
            else ctx.startService(svc);
        } catch (Exception ignored) {}
    }
}
