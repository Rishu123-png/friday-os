package com.rishu.fridayos;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Home-screen widget: shows FRIDAY's next thing (reminder / alarm) and a
 *  one-tap path into the app. Content is pushed over SharedPreferences by
 *  FridayNative.updateWidget(), so the widget never talks to the WebView.
 *
 *  If no widget is placed on the home screen, push() is harmless: it just
 *  updates empty widget-id arrays.
 */
public class FridayWidgetProvider extends AppWidgetProvider {

    public static final String PREFS = "FridayWidget";
    public static final String KEY_TEXT = "text";
    public static final String KEY_META = "meta";
    /* v7.5: steps line, written by FridaySensors into the "friday_health" file */
    private static final String HEALTH = "friday_health";
    private static final String KEY_STEPS_TODAY = "widget_steps_today";
    private static final String KEY_STEPS_DATE = "widget_steps_date";

    /** Called by FridaySensors whenever the step count moves. */
    public static void pushSteps(Context ctx, int steps) {
        try {
            String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .format(new java.util.Date());
            ctx.getSharedPreferences(HEALTH, Context.MODE_PRIVATE).edit()
               .putInt(KEY_STEPS_TODAY, steps)
               .putString(KEY_STEPS_DATE, today)
               .apply();
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(
                    new ComponentName(ctx, FridayWidgetProvider.class));
            if (ids.length > 0) new FridayWidgetProvider().onUpdate(ctx, mgr, ids);
        } catch (Exception ignored) {}
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String text = p.getString(KEY_TEXT, "Say \"Hey Friday\"");
        String meta = p.getString(KEY_META, "");

        /* v7.5: append today's steps to the meta line */
        try {
            SharedPreferences h = ctx.getSharedPreferences(HEALTH, Context.MODE_PRIVATE);
            String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .format(new java.util.Date());
            if (today.equals(h.getString(KEY_STEPS_DATE, ""))) {
                int steps = h.getInt(KEY_STEPS_TODAY, 0);
                if (steps > 0) {
                    String stepLine = String.format(java.util.Locale.US, "%,d steps", steps);
                    meta = meta.isEmpty() ? stepLine : meta + " - " + stepLine;
                }
            }
        } catch (Exception ignored) {}

        for (int id : ids) {
            try {
                RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.friday_widget);
                v.setTextViewText(R.id.widget_text, text);
                v.setTextViewText(R.id.widget_meta, meta);

                Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                if (open != null) {
                    PendingIntent pi = PendingIntent.getActivity(ctx, 7191, open,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    v.setOnClickPendingIntent(R.id.widget_root, pi);
                }
                mgr.updateAppWidget(id, v);
            } catch (Exception ignored) {}
        }
    }

    /** Push fresh text to every placed widget instance (safe no-op if none). */
    public static void push(Context ctx, String text, String meta) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
               .putString(KEY_TEXT, text)
               .putString(KEY_META, meta)
               .apply();

            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(
                    new ComponentName(ctx, FridayWidgetProvider.class));
            if (ids.length == 0) return;
            new FridayWidgetProvider().onUpdate(ctx, mgr, ids);
        } catch (Exception ignored) {}
    }
}
