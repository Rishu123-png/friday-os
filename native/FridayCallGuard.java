package com.rishu.fridayos;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.telephony.SmsManager;
import android.telephony.TelephonyManager;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Friday Call Guard (v10.3.0) — JARVIS answers what YOU don't want to.
 *
 * Honest Android reality: a regular app can NOT talk into an active phone
 * call (that is Google-Call-Screen territory, privileged). What FRIDAY can
 * do — and does — is: catch the incoming call, show a small "FRIDAY
 * sambhale?" card, and on tap politely DECLINE + send an explainer SMS
 * (or hand off a pre-filled WhatsApp message) so the caller still gets a
 * human-feeling answer from the one assistant who knows you.
 *
 * Everything is gated by the "friday_call_guard" SharedPrefs (written by
 * FridayNative.setCallGuard from the Settings UI). Disabled by default.
 * One explainer per caller per 10 minutes — never spam (see inboundLog).
 */
public class FridayCallGuard extends BroadcastReceiver {

    public static final String PREFS = "friday_call_guard";
    private static final String LOG = "friday_call_log";
    private static final String HANDLED = "friday_call_handled";
    public static final String EVT = "callHandled";

    private static View_ lastView;
    private static long lastRingAt = 0;
    private static String lastNumber = "";

    private static class View_ { android.view.View v; WindowManager wm; }

    /* ---- JS config bridge (called by FridayNative.setCallGuard) ---- */
    public static void configure(Context ctx, boolean enabled, String template, String mode) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("template", template == null ? "" : template)
            .putString("mode", mode == null ? "sms" : mode)
            .apply();
    }

    public static JSONArray readLog(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(LOG, Context.MODE_PRIVATE).getString("items", "[]"));
        } catch (Exception e) { return new JSONArray(); }
    }

    private static void log(Context ctx, String number, String action) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(LOG, Context.MODE_PRIVATE);
            JSONArray arr;
            try { arr = new JSONArray(sp.getString("items", "[]")); } catch (Exception e) { arr = new JSONArray(); }
            JSONObject o = new JSONObject();
            o.put("number", number); o.put("action", action); o.put("when", System.currentTimeMillis());
            arr.put(o);
            while (arr.length() > 50) arr.remove(0);
            sp.edit().putString("items", arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** ONE explainer per caller per gap — FRIDAY never spams anyone. */
    private static boolean spamGuard(Context ctx, String number, long gapMs) {
        SharedPreferences sp = ctx.getSharedPreferences(HANDLED, Context.MODE_PRIVATE);
        long last = sp.getLong(number, 0);
        if (System.currentTimeMillis() - last < gapMs) return false;
        sp.edit().putLong(number, System.currentTimeMillis()).apply();
        return true;
    }

    @Override
    public void onReceive(final Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        final SharedPreferences cfg = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!cfg.getBoolean("enabled", false)) return;

        final String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        final String incoming = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state) && incoming != null && !incoming.isEmpty()) {
            /* double-broadcast dedupe */
            if (incoming.equals(lastNumber) && System.currentTimeMillis() - lastRingAt < 4000) return;
            lastRingAt = System.currentTimeMillis(); lastNumber = incoming;
            showCard(ctx, incoming, cfg);
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state) || TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            removeCard();
            lastNumber = "";
        }
    }

    /* ---- the "FRIDAY sambhale?" overlay card ---- */
    private static void showCard(final Context ctx, final String number, final SharedPreferences cfg) {
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(ctx)) return;   // honest: no permission, no card
        removeCard();
        try {
            final WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                                                    : WindowManager.LayoutParams.TYPE_PHONE;
            final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                type, WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.y = 240;

            LinearLayout box = new LinearLayout(ctx);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setPadding(36, 28, 36, 28);
            box.setBackgroundColor(Color.argb(235, 6, 18, 32));

            TextView title = new TextView(ctx);
            title.setText("📞 " + number);
            title.setTextColor(Color.WHITE); title.setTextSize(16); title.setPadding(0, 0, 0, 6);
            box.addView(title);

            TextView q = new TextView(ctx);
            q.setText("FRIDAY sambhale? (decline + aapka message bhej dega)");
            q.setTextColor(0xFFBFEAFF); q.setTextSize(13); q.setPadding(0, 0, 0, 16);
            box.addView(q);

            LinearLayout row = new LinearLayout(ctx);
            row.setOrientation(LinearLayout.HORIZONTAL);
            Button friday = new Button(ctx); friday.setText("🦾 FRIDAY sambhale");
            Button me = new Button(ctx); me.setText("Khud uthaunga");
            row.addView(friday); row.addView(me);
            box.addView(row);

            final View_ holder = new View_(); holder.v = box; holder.wm = wm;
            lastView = holder;

            me.setOnClickListener(v -> removeCard());
            friday.setOnClickListener(v -> {
                removeCard();
                guardAnswer(ctx, number, cfg);
            });

            wm.addView(box, lp);
            new Handler(Looper.getMainLooper()).postDelayed(FridayCallGuard::removeCard, 24000);
        } catch (Exception e) { /* any overlay failure = no card, never crash */ }
    }

    private static void removeCard() {
        try {
            if (lastView != null && lastView.wm != null && lastView.v != null) {
                lastView.wm.removeView(lastView.v);
            }
        } catch (Exception ignored) {}
        lastView = null;
    }

    /* ---- decline + explain ---- */
    private static void guardAnswer(final Context ctx, final String number, final SharedPreferences cfg) {
        /* 1) politely decline (needs ANSWER_PHONE_CALLS permission) */
        boolean declined = false;
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) { tm.endCall(); declined = true; }
            }
        } catch (SecurityException se) {
            Toast.makeText(ctx, "FRIDAY: call-decline permission pending", Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {}
        if (!declined) return;   // never lie about what happened

        /* 2) ONE explainer per caller per 10min */
        if (!spamGuard(ctx, number, 10 * 60 * 1000)) { log(ctx, number, "declined_skipped_explainer"); return; }

        String template = cfg.getString("template", "");
        if (template.trim().isEmpty()) template = "Boss is busy right now — bataiye kya kaam hai, main unhe bata dunga. — FRIDAY";
        final String msg = template.replace("{name}", number).replace("{number}", number);
        final String mode = cfg.getString("mode", "sms");

        if ("whatsapp".equals(mode)) {
            try {
                String digits = number.replaceAll("[^0-9]", "");
                if (digits.length() == 10) digits = "91" + digits;
                Intent wa = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://wa.me/" + digits + "?text=" + Uri.encode(msg)));
                wa.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(wa);
                log(ctx, number, "declined_whatsapp_draft");
                FridayNative.emitCallHandled(number, "whatsapp_draft");
                return;
            } catch (Exception e) { /* fall through to SMS */ }
        }
        try {
            SmsManager sm = SmsManager.getDefault();
            sm.sendTextMessage(number, null, msg, null, null);
            log(ctx, number, "declined_sms_sent");
            FridayNative.emitCallHandled(number, "sms_sent");
            Toast.makeText(ctx, "FRIDAY handled it — " + number, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            log(ctx, number, "declined_sms_failed");
            FridayNative.emitCallHandled(number, "sms_failed");
        }
    }
}
