package com.rishu.fridayos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

/** Floating FRIDAY orb that sits on top of every app.
 *  Drag to move, tap to open FRIDAY. */
public class FridayBubbleService extends Service {

    private WindowManager wm;
    private View bubble;
    private GradientDrawable dot;
    private static FridayBubbleService instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    "friday_bubble", "FRIDAY Bubble", NotificationManager.IMPORTANCE_MIN);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
            Notification n = new Notification.Builder(this, "friday_bubble")
                    .setContentTitle("FRIDAY overlay active")
                    .setSmallIcon(android.R.drawable.ic_menu_compass)
                    .build();
            startForeground(7002, n);
        }

        try { addBubble(); } catch (Exception e) { stopSelf(); }
    }

    private void addBubble() {
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return; }

        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        int size = (int) (58 * getResources().getDisplayMetrics().density);

        FrameLayout root = new FrameLayout(this);
        View circle = new View(this);
        dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(Color.parseColor("#0a0a1a"));
        dot.setStroke((int) (2.5f * getResources().getDisplayMetrics().density),
                Color.parseColor("#00d4ff"));
        circle.setBackground(dot);
        FrameLayout.LayoutParams inner = new FrameLayout.LayoutParams(size, size);
        root.addView(circle, inner);
        bubble = root;

        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size, size, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = 20;
        lp.y = 320;

        bubble.setOnTouchListener(new View.OnTouchListener() {
            int ix, iy; float tx, ty; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        ix = lp.x; iy = lp.y; tx = e.getRawX(); ty = e.getRawY(); moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - tx), dy = (int) (e.getRawY() - ty);
                        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
                        lp.x = ix + dx; lp.y = iy + dy;
                        try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) {}
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) openApp();
                        return true;
                }
                return false;
            }
        });

        wm.addView(bubble, lp);
    }

    private void openApp() {
        try {
            Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (i != null) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                i.putExtra("from_bubble", true);
                startActivity(i);
            }
        } catch (Exception ignored) {}
    }

    /** idle | listening | speaking | processing */
    public static void setState(String state) {
        if (instance == null || instance.dot == null) return;
        final String color;
        switch (state) {
            case "listening":  color = "#ff006e"; break;
            case "speaking":   color = "#00ff88"; break;
            case "processing": color = "#ffaa00"; break;
            default:           color = "#00d4ff";
        }
        instance.bubble.post(() -> {
            try {
                instance.dot.setStroke(
                        (int) (2.5f * instance.getResources().getDisplayMetrics().density),
                        Color.parseColor(color));
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onDestroy() {
        try { if (wm != null && bubble != null) wm.removeView(bubble); } catch (Exception ignored) {}
        bubble = null; instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
