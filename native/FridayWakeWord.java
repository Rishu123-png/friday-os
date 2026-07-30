package com.rishu.fridayos;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Locale;

/** Always-on hotword engine (Picovoice Porcupine), fully reflection-based.
 *
 *  Why reflection: the Porcupine AAR is an OPTIONAL dependency. If it is not
 *  compiled into the APK, Class.forName fails and we resolve with
 *  ok:false / reason:"not_installed" - voice.js then silently falls back to
 *  the SpeechRecognizer restart loop. Nothing ever crashes.
 *
 *  Enable it in native/add_llama_dep.py (PORCUPINE_ENABLED = True) and put a
 *  free AccessKey from console.picovoice.ai into Settings > Wake keyword.
 */
@CapacitorPlugin(name = "FridayWakeWord")
public class FridayWakeWord extends Plugin {

    private static final String PKG = "ai.picovoice.porcupine.";

    private Object manager;          // PorcupineManager (reflection handle)
    private String activeKey = "";   // key currently in use, for dedup

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) {
        JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o;
    }

    @PluginMethod
    public void start(PluginCall call) {
        final String key = call.getString("accessKey", "");
        final String kw = call.getString("keyword", "jarvis");
        if (key.isEmpty()) { call.resolve(fail("no_key")); return; }

        /* Already running with the same key -> nothing to do */
        if (manager != null && key.equals(activeKey)) { call.resolve(ok()); return; }
        stopInternal();

        try {
            Class<?> pmCls = Class.forName(PKG + "PorcupineManager");
            Class<?> kwCls = Class.forName(PKG + "Porcupine$BuiltInKeyword");
            String enumName = kw.toUpperCase(Locale.ROOT).replace(' ', '_');
            Object keyword;
            try {
                keyword = Enum.valueOf((Class) kwCls, enumName);
            } catch (IllegalArgumentException badKw) {
                call.resolve(fail("bad_keyword"));
                return;
            }

            Class<?> cbCls = Class.forName(PKG + "PorcupineManagerCallback");
            Object cb = Proxy.newProxyInstance(cbCls.getClassLoader(), new Class<?>[] { cbCls },
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] args) {
                        if ("invoke".equals(method.getName())) emitWake();
                        return null;
                    }
                });

            Class<?> builderCls = Class.forName(PKG + "PorcupineManager$Builder");
            Object builder = builderCls.getDeclaredConstructor().newInstance();
            builderCls.getMethod("setAccessKey", String.class).invoke(builder, key);
            builderCls.getMethod("setKeyword", kwCls).invoke(builder, keyword);
            manager = builderCls.getMethod("build", Context.class, cbCls)
                        .invoke(builder, getContext(), cb);

            pmCls.getMethod("start").invoke(manager);
            activeKey = key;
            call.resolve(ok());

        } catch (ClassNotFoundException e) {
            call.resolve(fail("not_installed"));       // AAR not in this build -> JS fallback
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            String m = cause != null && cause.getMessage() != null ? cause.getMessage() : "porcupine_error";
            stopInternal();
            call.resolve(fail(m.toLowerCase(Locale.ROOT).contains("accesskey")
                    ? "bad_key" : clean(m)));
        } catch (Exception e) {
            stopInternal();
            call.resolve(fail(clean(e.getMessage())));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve(ok());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = ok();
        r.put("listening", manager != null);
        try {
            Class.forName(PKG + "PorcupineManager");
            r.put("engine", true);
        } catch (Exception e) {
            r.put("engine", false);
        }
        call.resolve(r);
    }

    private String clean(String m) {
        if (m == null || m.isEmpty()) return "porcupine_error";
        return m.length() > 60 ? m.substring(0, 60) : m;
    }

    private void stopInternal() {
        if (manager == null) { activeKey = ""; return; }
        try { manager.getClass().getMethod("stop").invoke(manager); } catch (Exception ignored) {}
        try { manager.getClass().getMethod("delete").invoke(manager); } catch (Exception ignored) {}
        manager = null;
        activeKey = "";
    }

    private void emitWake() {
        final JSObject o = new JSObject();
        o.put("keyword", "wake");
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                try { notifyListeners("wake", o); } catch (Exception ignored) {}
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
    }
}
