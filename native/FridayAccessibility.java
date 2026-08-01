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

    /* ============ v2: direct UI control (tap / scroll / type) ============ */
    /* Voice-driven screen control, useful hands-free and for less-able users.
       Everything fails cleanly with false when the service is off. */

    /** Tap the first node whose text or content-description matches. */
    public static boolean tapText(String text) {
        if (instance == null || text == null || text.isEmpty()) return false;
        try {
            AccessibilityNodeInfo root = instance.getRootInActiveWindow();
            if (root == null) return false;
            List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(text);
            if (nodes != null) {
                AccessibilityNodeInfo exact = null, partial = null;
                for (AccessibilityNodeInfo n : nodes) {
                    if (n == null) continue;
                    CharSequence t = n.getText() != null ? n.getText() : n.getContentDescription();
                    if (t == null) continue;
                    String s = t.toString();
                    if (s.equalsIgnoreCase(text)) { exact = n; break; }
                    if (partial == null) partial = n;
                }
                AccessibilityNodeInfo target = exact != null ? exact : partial;
                if (target != null) return clickNodeStatic(target);
            }
            /* not found by exact text: walk the tree once for a fuzzy match */
            return clickMatching(root, text.toLowerCase(), 0);
        } catch (Exception e) { return false; }
    }

    private static boolean clickMatching(AccessibilityNodeInfo node, String needle, int depth) {
        if (node == null || depth > 6) return false;
        CharSequence t = node.getText() != null ? node.getText() : node.getContentDescription();
        if (t != null && t.toString().toLowerCase().contains(needle)) {
            if (clickNodeStatic(node)) return true;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            if (clickMatching(node.getChild(i), needle, depth + 1)) return true;
        }
        return false;
    }

    /** Scroll the first scrollable container on screen. dir: up|down|left|right */
    public static boolean scrollScreen(String dir) {
        if (instance == null) return false;
        try {
            AccessibilityNodeInfo root = instance.getRootInActiveWindow();
            AccessibilityNodeInfo sc = findScrollable(root, 0);
            if (sc == null) return false;
            int action = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            if ("up".equals(dir) || "left".equals(dir)) {
                action = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            }
            return sc.performAction(action);
        } catch (Exception e) { return false; }
    }

    private static AccessibilityNodeInfo findScrollable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 8) return null;
        if (n.isScrollable()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findScrollable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    /** Set text into the focused editable node (or the first visible one). */
    public static boolean typeText(String text) {
        if (instance == null || text == null) return false;
        try {
            AccessibilityNodeInfo root = instance.getRootInActiveWindow();
            if (root == null) return false;
            AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (target == null || !target.isEditable()) target = findEditable(root, 0);
            if (target == null) return false;
            android.os.Bundle args = new android.os.Bundle();
            args.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        } catch (Exception e) { return false; }
    }

    private static AccessibilityNodeInfo findEditable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 8) return null;
        if (n.isEditable() && n.isVisibleToUser()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findEditable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    /* v7.6: read the screen like Gemini Live's "see my screen" - dump all
       visible text so the assistant can read/summarize/translate it. */
    public static String dumpScreenText(int maxChars) {
        try {
            FridayAccessibility svc = instance;
            if (svc == null) return null;
            AccessibilityNodeInfo root = svc.getRootInActiveWindow();
            if (root == null) return null;
            StringBuilder out = new StringBuilder();
            collectText(root, out, 0);
            String s = out.toString().replaceAll("(\\s*\\n){3,}", "\\n\\n").trim();
            return s.length() > maxChars ? s.substring(0, maxChars) : s;
        } catch (Throwable t) { return null; }
    }

    private static void collectText(AccessibilityNodeInfo n, StringBuilder out, int depth) {
        if (n == null || depth > 14 || out.length() > 6000) return;
        try {
            CharSequence t = n.getText() != null ? n.getText() : n.getContentDescription();
            if (t != null) {
                String s = t.toString().trim();
                if (!s.isEmpty() && !out.toString().endsWith(s + "\n")) {
                    out.append(s).append('\n');
                }
            }
            for (int i = 0; i < n.getChildCount(); i++) collectText(n.getChild(i), out, depth + 1);
        } catch (Throwable ignored) {}
    }

    private static boolean clickNodeStatic(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo cur = n;
        for (int i = 0; i < 5 && cur != null; i++) {
            if (cur.isClickable()) return cur.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            cur = cur.getParent();
        }
        return false;
    }

    /* ============ v8.1 EYES: on-demand screenshot + coordinate tap ============ */
    public interface ShotCb { void onShot(android.graphics.Bitmap bmp); }

    /** One fresh frame via the accessibility screenshot API (Android 11+).
        No consent dialog, no MediaProjection stream - on-demand and light. */
    public static boolean takeShot(final ShotCb cb) {
        final FridayAccessibility svc = instance;
        if (svc == null || cb == null) return false;
        if (android.os.Build.VERSION.SDK_INT < 30) return false;
        try {
            svc.takeScreenshot(android.view.Display.DEFAULT_DISPLAY, svc.getMainExecutor(),
                new AccessibilityService.TakeScreenshotCallback() {
                    @Override public void onSuccess(AccessibilityService.ScreenshotResult res) {
                        android.graphics.Bitmap out = null;
                        try {
                            android.hardware.HardwareBuffer buf = res.getHardwareBuffer();
                            android.graphics.Bitmap hw = android.graphics.Bitmap.wrapHardwareBuffer(buf, res.getColorSpace());
                            if (buf != null) buf.close();
                            if (hw != null) { out = hw.copy(android.graphics.Bitmap.Config.ARGB_8888, false); hw.recycle(); }
                        } catch (Throwable ignored) {}
                        cb.onShot(out);
                    }
                    @Override public void onFailure(int errorCode) { cb.onShot(null); }
                });
            return true;
        } catch (Throwable t) { return false; }
    }

    /** Physical tap at exact pixel coordinates - pairs with vision ("tap the blue button"). */
    public static boolean tapAt(float x, float y) {
        FridayAccessibility svc = instance;
        if (svc == null || android.os.Build.VERSION.SDK_INT < 24) return false;
        try {
            android.graphics.Path p = new android.graphics.Path();
            p.moveTo(x, y);
            android.accessibilityservice.GestureDescription g = new android.accessibilityservice.GestureDescription.Builder()
                .addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(p, 0, 60)).build();
            svc.dispatchGesture(g, null, null);
            return true;
        } catch (Throwable t) { return false; }
    }
}
