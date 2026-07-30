package com.rishu.fridayos;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/** Lets FRIDAY perform system gestures (back, home, recents, notifications).
 *  User must enable it under Settings > Accessibility. */
public class FridayAccessibility extends AccessibilityService {

    private static FridayAccessibility instance;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { }

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
