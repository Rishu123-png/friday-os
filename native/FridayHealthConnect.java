package com.rishu.fridayos;

import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Health Connect bridge - 100% reflection, same house style as Porcupine
 *  and LlamaEngine: if the Health Connect SDK/app is missing, EVERY call
 *  degrades to a friendly answer and nothing can crash.
 *
 *  Status model:
 *    SDK_AVAILABLE     -> Android 14+ (HC built in) or HC app installed
 *    not installed     -> we deep-link the user to the Play Store page
 *    permission denied -> we deep-link the user to HC's permission manager
 *                         with our package name pre-selected
 *
 *  Kotlin interop note: readRecords() is a `suspend` function, so we call it
 *  with a hand-made Continuation and block a latch for the result. The
 *  kotlin-stdlib classes come transitively from the connect-client AAR.
 */
@CapacitorPlugin(name = "FridayHealthConnect")
public class FridayHealthConnect extends Plugin {

    private static final String HC = "androidx.health.connect.client.";
    private static final String HC_CONTROLLER_PKG = "com.google.android.healthconnect.controller";
    private static final String PERM_STEPS = "android.permission.health.READ_STEPS";

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) { JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why == null ? "unknown" : why); return o; }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            boolean sdkPresent = classExists(HC + "HealthConnectClient");
            boolean hcApp = packageExists(HC_CONTROLLER_PKG);
            JSObject r = ok();
            r.put("sdk", sdkPresent);
            r.put("hcApp", hcApp);
            call.resolve(r);
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /** Opens Health Connect's own permission manager for THIS app. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = null;
            try {
                i = new Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS");
                i.putExtra(Intent.EXTRA_PACKAGE_NAME, ctx.getPackageName());
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Throwable notOnThisVersion) {
                i = null;
            }
            if (i == null) {
                // fallback: open the Health Connect app itself
                try {
                    Intent li = ctx.getPackageManager().getLaunchIntentForPackage(HC_CONTROLLER_PKG);
                    if (li != null) { li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); ctx.startActivity(li); call.resolve(ok()); return; }
                } catch (Throwable ignored) {}
                // final fallback: Play Store page for the HC app
                Intent store = new Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("market://details?id=com.google.android.apps.healthdata"));
                store.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(store);
            }
            call.resolve(ok());
        } catch (Throwable t) { call.resolve(fail(t.getMessage())); }
    }

    /** Steps walked in the last `days` days, read from Health Connect. */
    @PluginMethod
    public void readSteps(PluginCall call) {
        final int days = Math.max(1, call.getInt("days", 1));
        new Thread(() -> {
            try {
                Object client = healthClient();
                if (client == null) { call.resolve(fail("no_health_connect")); return; }

                if (!hasStepPermission(client)) { call.resolve(fail("hc_permission")); return; }

                Instant end = Instant.now();
                Instant start = end.minus(java.time.Duration.ofDays(days));

                Class<?> recCls = Class.forName(HC + "records.StepsRecord");
                Class<?> trfCls = Class.forName(HC + "time.TimeRangeFilter");
                Method between = null;
                for (Method m : trfCls.getDeclaredMethods()) {
                    if (m.getName().equals("between")
                            && m.getParameterTypes().length == 2
                            && m.getParameterTypes()[0] == Instant.class) { between = m; break; }
                }
                if (between == null) { call.resolve(fail("hc_api_changed")); return; }
                Object range = between.invoke(null, start, end);

                Class<?> reqCls = Class.forName(HC + "request.ReadRecordsRequest");
                Object request = null;
                for (java.lang.reflect.Constructor<?> c : reqCls.getDeclaredConstructors()) {
                    Class<?>[] pt = c.getParameterTypes();
                    if (pt.length >= 4 && pt[0] == Class.class) {
                        // (Class<T> recordType, TimeRangeFilter, Set<DataOrigin>, boolean, int, String)
                        Object[] args = new Object[pt.length];
                        args[0] = recCls;
                        args[1] = range;
                        for (int i = 2; i < pt.length; i++) {
                            if (pt[i] == java.util.Set.class) args[i] = Collections.emptySet();
                            else if (pt[i] == List.class) args[i] = Collections.emptyList();
                            else if (pt[i] == boolean.class || pt[i] == Boolean.class) args[i] = true;
                            else if (pt[i] == int.class || pt[i] == Integer.class) args[i] = 5000;
                            else args[i] = null;
                        }
                        c.setAccessible(true);
                        request = c.newInstance(args);
                        break;
                    }
                }
                if (request == null) { call.resolve(fail("hc_api_changed")); return; }

                Method read = null;
                for (Method m : client.getClass().getMethods()) {
                    if (m.getName().equals("readRecords") && m.getParameterTypes().length == 2) { read = m; break; }
                }
                if (read == null) { call.resolve(fail("hc_api_changed")); return; }

                Object response = callSuspend(read, client, request);
                List<?> records = extractRecords(response);
                long total = 0;
                if (records != null) {
                    for (Object rec : records) {
                        try {
                            Method getCount = rec.getClass().getMethod("getCount");
                            Object v = getCount.invoke(rec);
                            if (v instanceof Number) total += ((Number) v).longValue();
                        } catch (Throwable ignored) {}
                    }
                }
                JSObject r = ok();
                r.put("steps", total);
                r.put("days", days);
                call.resolve(r);
            } catch (Throwable t) {
                String m = String.valueOf(t.getMessage());
                call.resolve(fail(m.contains("Permission") || m.contains("ecurity") ? "hc_permission" : "hc_error"));
            }
        }).start();
    }

    /* ================= reflection helpers ================= */

    private boolean classExists(String name) {
        try { Class.forName(name); return true; } catch (Throwable t) { return false; }
    }

    private boolean packageExists(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Throwable t) { return false; }
    }

    private Object healthClient() {
        try {
            Class<?> hcCls = Class.forName(HC + "HealthConnectClient");
            Field companion = hcCls.getDeclaredField("Companion");
            Object comp = companion.get(null);
            Method getOrCreate = comp.getClass().getMethod("getOrCreate", Context.class);
            return getOrCreate.invoke(comp, getContext());
        } catch (Throwable t) { return null; }
    }

    /** permissionController.getGrantedPermissions() is ALSO a suspend call. */
    private boolean hasStepPermission(Object client) {
        try {
            Method getPc = client.getClass().getMethod("getPermissionController");
            Object pc = getPc.invoke(client);
            for (Method m : pc.getClass().getMethods()) {
                if (m.getName().equals("getGrantedPermissions") && m.getParameterTypes().length == 1) {
                    Object res = callSuspend(m, pc, null);
                    if (res == null) return true;   // can't verify -> let read decide
                    java.util.Collection<?> perms = (res instanceof java.util.Collection)
                            ? (java.util.Collection<?>) res : null;
                    if (perms == null) return true;
                    for (Object p : perms) if (PERM_STEPS.equals(String.valueOf(p))) return true;
                    return false;
                }
            }
            return true;   // older API without this method -> attempt read
        } catch (Throwable t) { return true; }
    }

    /** Invokes a Kotlin suspend method reflectively and blocks for the value. */
    private Object callSuspend(Method m, Object target, Object arg) throws Throwable {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Object> box = new AtomicReference<>();
        final AtomicReference<Throwable> err = new AtomicReference<>();

        kotlin.coroutines.Continuation<Object> cont = new kotlin.coroutines.Continuation<Object>() {
            @Override public kotlin.coroutines.CoroutineContext getContext() {
                return kotlin.coroutines.EmptyCoroutineContext.INSTANCE;
            }
            @Override public void resumeWith(Object result) {
                try {
                    Object value = unboxResult(result);
                    box.set(value);
                } catch (Throwable t) {
                    err.set(t);
                }
                latch.countDown();
            }
        };

        Object ret = (arg != null) ? m.invoke(target, arg, cont) : m.invoke(target, cont);
        if (ret != null && !ret.getClass().getName().contains("CoroutineSingletons")) {
            // function returned synchronously (rare but valid)
            return ret;
        }
        latch.await(10, TimeUnit.SECONDS);
        if (err.get() != null) throw err.get();
        return box.get();
    }

    /** resumeWith receives kotlin.Result - unwrap success value / failure. */
    private Object unboxResult(Object result) throws Throwable {
        if (result == null) return null;
        String cn = result.getClass().getName();
        if (cn.equals("kotlin.Result$Failure")) {
            Field f = result.getClass().getDeclaredField("exception");
            f.setAccessible(true);
            throw (Throwable) f.get(result);
        }
        try {
            Field f = result.getClass().getDeclaredField("value");
            f.setAccessible(true);
            Object v = f.get(result);
            // if value itself is the Failure wrapper
            if (v != null && v.getClass().getName().equals("kotlin.Result$Failure")) return unboxResult(v);
            return v != null ? v : result;
        } catch (NoSuchFieldException nf) {
            return result;
        }
    }

    @SuppressWarnings("unchecked")
    private List<?> extractRecords(Object response) {
        if (response == null) return null;
        try {
            Method getRecords = response.getClass().getMethod("getRecords");
            return (List<?>) getRecords.invoke(response);
        } catch (Throwable t) { return null; }
    }
}
