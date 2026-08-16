package com.rishu.fridayos;

import android.app.Activity;
import android.app.PendingIntent;
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
 * Friday Call Assistant — announces a caller and offers accept, decline,
 * silence, or an explicitly previewed decline-and-message action.
 *
 * Honest Android reality: a regular app cannot intercept both cellular-call
 * audio streams or inject an AI voice. Call control also depends on Android's
 * ANSWER_PHONE_CALLS/default-dialer policy. Every failure is surfaced; no
 * action is claimed unless Android accepted it. Message-back remains a direct
 * user tap bound to the displayed recipient and template.
 */
public class FridayCallGuard extends BroadcastReceiver {

    public static final String PREFS = "friday_call_guard";
    private static final String LOG = "friday_call_log";
    private static final String HANDLED = "friday_call_handled";
    public static final String EVT = "callHandled";
    private static final String ACTION_SMS_RESULT = "com.rishu.fridayos.CALL_SMS_RESULT";

    private static View_ lastView;
    private static long lastRingAt = 0;
    private static String lastNumber = "";
    private static boolean lastRingDelivered = false;
    private static Runnable pendingUnknownRing;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static class View_ { android.view.View v; WindowManager wm; }

    /* ---- JS config bridge (called by FridayNative.setCallGuard) ---- */
    public static boolean configure(Context ctx, boolean enabled, String template, String mode) {
        String exactTemplate = template == null ? "" : template
                .replaceAll("[\\p{Cntrl}\\r\\n]+", " ").replaceAll("\\s+", " ").trim();
        if (exactTemplate.length() > 500) exactTemplate = exactTemplate.substring(0, 500).trim();
        String exactMode = "whatsapp".equals(mode) ? "whatsapp" : "sms";
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("template", exactTemplate)
            .putString("mode", exactMode)
            .commit();
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
        long now = System.currentTimeMillis();
        if (now - last < gapMs) return false;
        /* Persist the one-message guard before opening any delivery path. */
        return sp.edit().putLong(number, now).commit();
    }

    @Override
    public void onReceive(final Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (ACTION_SMS_RESULT.equals(intent.getAction())) {
            String number = intent.getStringExtra("number");
            if (number == null) number = "";
            if (getResultCode() == Activity.RESULT_OK) {
                log(ctx, number, "declined_sms_sent");
                FridayNative.emitCallHandled(number, "sms_sent");
                Toast.makeText(ctx, "Message sent to the confirmed caller", Toast.LENGTH_SHORT).show();
            } else {
                log(ctx, number, "declined_sms_failed");
                FridayNative.emitCallHandled(number, "sms_failed");
                Toast.makeText(ctx, "The confirmed SMS could not be sent", Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        final SharedPreferences cfg = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final SharedPreferences assistant = ctx.getSharedPreferences(FridayAssistantSpeech.PREFS, Context.MODE_PRIVATE);
        final boolean announceEnabled = assistant.getBoolean("proactive_enabled", false)
                && assistant.getBoolean("call_announcements", true)
                && !assistant.getBoolean("private_mode", false);
        final boolean controlsEnabled = cfg.getBoolean("enabled", false);
        if (!announceEnabled && !controlsEnabled) return;

        final String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        final String rawIncoming = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        final String incoming = rawIncoming == null ? "" : rawIncoming.trim();

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            /* Some Android builds send a numberless broadcast just before the named one.
               Briefly defer the generic event so speech/card delivery happens once. */
            String dedupeNumber = incoming.isEmpty() ? "unknown" : incoming;
            long now = System.currentTimeMillis();
            long sinceLast = now - lastRingAt;
            if (sinceLast < 4000 && dedupeNumber.equals(lastNumber)) return;
            if (sinceLast < 4000 && incoming.isEmpty() && !lastNumber.isEmpty()
                    && !"unknown".equals(lastNumber)) return;
            if (sinceLast < 4000 && !incoming.isEmpty() && "unknown".equals(lastNumber)) {
                if (pendingUnknownRing != null) {
                    MAIN.removeCallbacks(pendingUnknownRing);
                    pendingUnknownRing = null;
                }
                boolean genericWasDelivered = lastRingDelivered;
                lastRingAt = now; lastNumber = incoming;
                if (genericWasDelivered) {
                    /* Upgrade the existing card silently; never announce the same call twice. */
                    if (controlsEnabled) deliverCallCard(ctx, incoming, cfg);
                    return;
                }
                deliverRinging(ctx, incoming, announceEnabled, controlsEnabled, assistant, cfg);
                lastRingDelivered = true;
                return;
            }

            if (pendingUnknownRing != null) {
                MAIN.removeCallbacks(pendingUnknownRing);
                pendingUnknownRing = null;
            }
            lastRingAt = now; lastNumber = dedupeNumber; lastRingDelivered = false;
            if (incoming.isEmpty()) {
                final Context appContext = ctx.getApplicationContext();
                pendingUnknownRing = () -> {
                    pendingUnknownRing = null;
                    if (!"unknown".equals(lastNumber)) return;
                    deliverRinging(appContext, "", announceEnabled, controlsEnabled, assistant, cfg);
                    lastRingDelivered = true;
                };
                MAIN.postDelayed(pendingUnknownRing, 650);
            } else {
                deliverRinging(ctx, incoming, announceEnabled, controlsEnabled, assistant, cfg);
                lastRingDelivered = true;
            }
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state) || TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            if (pendingUnknownRing != null) {
                MAIN.removeCallbacks(pendingUnknownRing);
                pendingUnknownRing = null;
            }
            removeCard();
            lastNumber = "";
            lastRingDelivered = false;
        }
    }

    private static void deliverRinging(Context ctx, String incoming, boolean announceEnabled,
                                       boolean controlsEnabled, SharedPreferences assistant,
                                       SharedPreferences cfg) {
        String caller = incoming.isEmpty() ? "an unknown caller" : callerName(ctx, incoming);
        boolean canRevealAudio = FridayAssistantSpeech.canReveal(ctx);
        if (announceEnabled) {
            String address = assistant.getString("address", "Boss");
            String spokenCaller = canRevealAudio ? caller : "someone";
            FridayAssistantSpeech.speak(ctx, address + ", " + spokenCaller
                    + " is calling" + (controlsEnabled ? ". Accept, decline, or silence?" : "."), false);
        }
        if (controlsEnabled) showCard(ctx, incoming, caller, canDisplayCaller(ctx), cfg);
    }

    private static void deliverCallCard(Context ctx, String incoming, SharedPreferences cfg) {
        String caller = incoming.isEmpty() ? "an unknown caller" : callerName(ctx, incoming);
        showCard(ctx, incoming, caller, canDisplayCaller(ctx), cfg);
    }

    /** Headphones can make speech private, but never make lock-screen visuals private. */
    private static boolean canDisplayCaller(Context ctx) {
        return FridayAssistantSpeech.canDisplayPrivateContent(ctx);
    }

    /* ---- the "FRIDAY sambhale?" overlay card ---- */
    private static void showCard(final Context ctx, final String number, final String caller,
                                 final boolean canReveal, final SharedPreferences cfg) {
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
            title.setText("📞 " + (canReveal ? caller : "Private caller"));
            title.setTextColor(Color.WHITE); title.setTextSize(16); title.setPadding(0, 0, 0, 6);
            box.addView(title);

            String template = cfg.getString("template", "");
            if (template.trim().isEmpty()) template = "Boss is busy right now — bataiye kya kaam hai, main unhe bata dunga. — FRIDAY";
            final String preview = template.replace("{name}", caller).replace("{number}", number);
            final String messageMode = "whatsapp".equals(cfg.getString("mode", "sms")) ? "whatsapp" : "sms";
            TextView q = new TextView(ctx);
            final boolean canMessage = canReveal && !number.isEmpty();
            q.setText(!canReveal
                    ? "Caller and message details are hidden while locked. Unlock or use private audio to enable Message."
                    : number.isEmpty()
                        ? "Android did not expose the caller number. Accept, Decline and Silence may still work; Message is unavailable."
                        : "Choose one action. Message sends exactly to " + caller + ":\n“" + preview + "”");
            q.setTextColor(0xFFBFEAFF); q.setTextSize(13); q.setPadding(0, 0, 0, 16);
            box.addView(q);

            LinearLayout row1 = new LinearLayout(ctx);
            row1.setOrientation(LinearLayout.HORIZONTAL);
            Button accept = new Button(ctx); accept.setText("Accept");
            Button decline = new Button(ctx); decline.setText("Decline");
            row1.addView(accept); row1.addView(decline); box.addView(row1);
            LinearLayout row2 = new LinearLayout(ctx);
            row2.setOrientation(LinearLayout.HORIZONTAL);
            Button silence = new Button(ctx); silence.setText("Silence");
            Button message = new Button(ctx); message.setText("Decline + message");
            message.setEnabled(canMessage);
            row2.addView(silence); row2.addView(message); box.addView(row2);

            final View_ holder = new View_(); holder.v = box; holder.wm = wm;
            lastView = holder;

            accept.setOnClickListener(v -> { removeCard(); acceptCall(ctx, number); });
            decline.setOnClickListener(v -> { removeCard(); declineOnly(ctx, number); });
            silence.setOnClickListener(v -> { removeCard(); silenceCall(ctx, number); });
            message.setOnClickListener(v -> {
                removeCard();
                guardAnswer(ctx, number, preview, messageMode);
            });

            wm.addView(box, lp);
            /* If the phone locks or Private mode is enabled while this card is
               visible, remove already-rendered caller/message details immediately. */
            MAIN.postDelayed(new Runnable() {
                @Override public void run() {
                    if (lastView != holder) return;
                    if (!FridayAssistantSpeech.canReveal(ctx)) {
                        removeCard();
                        return;
                    }
                    MAIN.postDelayed(this, 500);
                }
            }, 500);
            MAIN.postDelayed(FridayCallGuard::removeCard, 24000);
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

    private static boolean isRinging(Context ctx) {
        try {
            TelephonyManager phone = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            return phone != null && phone.getCallState() == TelephonyManager.CALL_STATE_RINGING;
        } catch (SecurityException ignored) {
            return false;
        }
    }

    private static void acceptCall(Context ctx, String number) {
        if (!isRinging(ctx)) {
            log(ctx, number, "accept_stale");
            Toast.makeText(ctx, "That incoming call is no longer ringing", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.acceptRingingCall();
                    /* This API has no success result; report the request, not an unverified completion. */
                    log(ctx, number, "accept_requested");
                    FridayNative.emitCallHandled(number, "accept_requested"); return;
                }
            }
        } catch (SecurityException e) {
            Toast.makeText(ctx, "Android requires call-control/default-dialer permission", Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {}
        log(ctx, number, "accept_unavailable");
    }

    private static boolean declineOnly(Context ctx, String number) {
        if (!isRinging(ctx)) {
            log(ctx, number, "decline_stale");
            Toast.makeText(ctx, "That incoming call is no longer ringing", Toast.LENGTH_LONG).show();
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null && tm.endCall()) {
                    log(ctx, number, "declined"); FridayNative.emitCallHandled(number, "declined"); return true;
                }
            }
        } catch (SecurityException e) {
            Toast.makeText(ctx, "Android requires call-control/default-dialer permission", Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {}
        log(ctx, number, "decline_unavailable");
        return false;
    }

    private static void silenceCall(Context ctx, String number) {
        if (!isRinging(ctx)) {
            log(ctx, number, "silence_stale");
            Toast.makeText(ctx, "That incoming call is no longer ringing", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.silenceRinger();
                    /* This API has no success result; report the request, not an unverified completion. */
                    log(ctx, number, "silence_requested");
                    FridayNative.emitCallHandled(number, "silence_requested"); return;
                }
            }
        } catch (SecurityException e) {
            Toast.makeText(ctx, "Android did not allow FRIDAY to silence this call", Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {}
        log(ctx, number, "silence_unavailable");
    }

    private static String callerName(Context ctx, String number) {
        android.database.Cursor c = null;
        try {
            Uri uri = Uri.withAppendedPath(android.provider.ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                    Uri.encode(number));
            c = ctx.getContentResolver().query(uri,
                    new String[]{android.provider.ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.trim().isEmpty()) return name.trim();
            }
        } catch (SecurityException ignored) {
        } finally { if (c != null) c.close(); }
        return number;
    }

    /* ---- explicitly confirmed decline + explain ---- */
    private static void guardAnswer(final Context ctx, final String number,
                                    final String exactMessage, final String exactMode) {
        /* Re-check at the action boundary: the phone may have locked or entered Private mode
           after this card was drawn, and a withheld number can never be a message recipient. */
        if (number == null || number.trim().isEmpty() || !canDisplayCaller(ctx)) {
            Toast.makeText(ctx, "Unlock to confirm this exact caller and message", Toast.LENGTH_LONG).show();
            return;
        }
        if (!declineOnly(ctx, number)) return;   // never lie or send after a failed decline

     