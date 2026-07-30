package com.rishu.fridayos;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/** Lets FRIDAY perform system gestures and auto-tap WhatsApp's send button.
 *  User must enable it under Settings > Accessibility. */
public class FridayAccessibility extends AccessibilityService {

    private static FridayAccessibility instance;

    /** When > now, we're waiting for WhatsApp to open so we can tap Send. */
    private static long autoSendUntil = 0;
    private static int autoSendTries = 0;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (System.currentTimeMillis() > autoSendUntil) return;
        if (event == null) return;

        CharSequence pkg = event.getPackageName();
        if (pkg == null || !pkg.toString().contains("whatsapp")) return;

        // give the compose box a moment to populate, then tap send
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() { tryTapSend(); }
        }, 700);
    }

    private void tryTapSend() {
        if (System.currentTimeMillis() > autoSendUntil) return;
        if (autoSendTries++ > 12) { autoSendUntil = 0; return; }

        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) { retry(); return; }

            // WhatsApp's send button id
            List<AccessibilityNodeInfo> nodes =
                    root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send");

            if (nodes == null || nodes.isEmpty()) {
                nodes = root.findAccessibilityNodeInfosByText("Send");
            }

            if (nodes != null) {
                for (AccessibilityNodeInfo n : nodes) {
                    if (n == null) continue;
                    if (clickNode(n)) {
                        autoSendUntil = 0;   // done
                        autoSendTries = 0;
                        return;
                    }
                }
            }
            retry();
        } catch (Exception e) { retry(); }
    }

    private boolean clickNode(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo cur = n;
        for (int i = 0; i < 5 && cur != null; i++) {
            if (cur.isClickable()) {
                return cur.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            cur = cur.getParent();
        }
        return false;
    }

    private void retry() {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() { tryTapSend(); }
        }, 500);
    }

    /** Called by the plugin right before WhatsApp is opened. */
    public static void requestAutoSend() {
        autoSendUntil = System.currentTimeMillis() + 12000;   // 12s window
        autoSendTries = 0;
    }

    public static boolean isEnabled() { return instance != null; }

    @Override
    public void onInterrupt() { }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    /** Called from the plugin. Returns false if the service isn't enabled. */
    public static boolean doGlobal(String action) {
        if (instance == null) return false;
        int id;
        switch (action) {
            case "back":          id = GLOBAL_ACTION_BACK; break;
            case "home":          id = GLOBAL_ACTION_HOME; break;
            case "recents":       id = GLOBAL_ACTION_RECENTS; break;
            case "notifications": id = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quicksettings": id = GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "lock":
                if (android.os.Build.VERSION.SDK_INT >= 28) { id = GLOBAL_ACTION_LOCK_SCREEN; break; }
                return false;
            case "screenshot":
                if (android.os.Build.VERSION.SDK_INT >= 28) { id = GLOBAL_ACTION_TAKE_SCREENSHOT; break; }
                return false;
            default: return false;
        }
        try { return instance.performGlobalAction(id); }
        catch (Exception e) { return false; }
    }
}
