package com.rishu.fridayos;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.File;
import java.lang.reflect.Proxy;
import java.util.Locale;

/** Keyless always-on wake-word engine (Vosk), fully reflection-based.
 *
 *  Why it exists: Picovoice requires an account + company email. Vosk needs
 *  NOTHING - no key, no internet, and ANY custom word works ("friday",
 *  "jarvis", ...), which Porcupine's built-in list cannot do.
 *
 *  Why reflection: the AAR (com.alphacephei:vosk-android) is bundled by
 *  native/add_llama_dep.py at build time. If a build is ever made without it,
 *  Class.forName fails -> ok:false / reason:"not_installed", and voice.js
 *  silently falls back to the software listener. Nothing ever crashes.
 *
 *  The ~36MB Indian-English model zip downloads once from alphacephei.com into
 *  internal storage (no account, no tracking) and then works 100% offline.
 *  Events: "wake" (word detected), "voskProgress" ({percent}) during download,
 *  "voskError" ({message}). Same event contract as FridayWakeWord.
 */
@CapacitorPlugin(name = "FridayVosk")
public class FridayVosk extends Plugin {

    private static final int WAKE_DEBOUNCE_MS = 1500;

    private Object service;       // org.vosk.android.SpeechService (reflection handle)
    private Object recognizer;    // org.vosk.Recognizer
    private Object model;         // org.vosk.Model
    private String activeModelDir = "";
    private String[] grammar = new String[0];
    private boolean starting = false;
    private long lastWakeAt = 0;

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) {
        JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o;
    }

    private void post(Runnable r) { new Handler(Looper.getMainLooper()).post(r); }

    private File defaultModelDir() { return new File(getContext().getFilesDir(), "vosk/wake-model"); }

    private static boolean looksLikeModel(File dir) {
        return dir != null && dir.isDirectory() && new File(dir, "am/final.mdl").exists();
    }

    @PluginMethod
    public void start(final PluginCall call) {
        String modelPath = call.getString("modelPath", "");
        if (modelPath == null || modelPath.trim().isEmpty()) modelPath = defaultModelDir().getAbsolutePath();
        final String dir = modelPath.trim();
        if (!looksLikeModel(new File(dir))) { call.resolve(fail("no_model")); return; }

        String kw = call.getString("keyword", "friday");
        if (kw == null || kw.trim().isEmpty()) kw = "friday";
        final String keyword = kw.toLowerCase(Locale.ROOT).trim();

        /* already running with the same config -> nothing to do */
        if (service != null && dir.equals(activeModelDir)) { call.resolve(ok()); return; }
        if (starting) { call.resolve(fail("busy")); return; }
        if (getContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            call.resolve(fail("no_mic")); return;
        }

        stopInternal();
        starting = true;
        new Thread(() -> {
            try {
                Class<?> modelCls = Class.forName("org.vosk.Model");
                Object m = modelCls.getConstructor(String.class).newInstance(dir);

                /* keyword-spotting grammar: only our words + [unk] ever come out */
                JSONArray g = new JSONArray();
                java.util.ArrayList<String> words = new java.util.ArrayList<>();
                for (String w : keyword.split("[\\s,;/]+")) {
                    if (w.matches("[a-z][a-z0-9']*")) { g.put(w); words.add(w); }
                }
                g.put("[unk]");

                Class<?> recCls = Class.forName("org.vosk.Recognizer");
                Object r = recCls
                    .getConstructor(modelCls, float.class, String.class)
                    .newInstance(m, 16000.0f, g.toString());

                Class<?> svcCls = Class.forName("org.vosk.android.SpeechService");
                Object s = svcCls
                    .getConstructor(recCls, float.class)
                    .newInstance(r, 16000.0f);

                Class<?> lCls = Class.forName("org.vosk.android.RecognitionListener");
                Object listener = Proxy.newProxyInstance(
                    lCls.getClassLoader(), new Class<?>[] { lCls },
                    (proxy, method, args) -> {
                        String n = method.getName();
                        if (("onPartialResult".equals(n) || "onResult".equals(n)
                                || "onFinalResult".equals(n))
                                && args != null && args.length > 0 && args[0] instanceof String) {
                            maybeWake((String) args[0]);
                        } else if ("onError".equals(n)) {
                            JSObject ev = new JSObject();
                            ev.put("message", args != null && args.length > 0 && args[0] != null
                                ? args[0].toString() : "unknown");
                            emit("voskError", ev);
                            stopInternal();
                        }
                        return null;
                    });

                svcCls.getMethod("startListening", lCls).invoke(s, listener);

                model = m; recognizer = r; service = s;
                activeModelDir = dir;
                grammar = words.toArray(new String[0]);
                starting = false;
                post(() -> call.resolve(ok()));
            } catch (ClassNotFoundException notInstalled) {
                starting = false;
                post(() -> call.resolve(fail("not_installed")));
            } catch (Throwable t) {
                starting = false;
                stopInternal();
                final String why = (t instanceof SecurityException
                        || t.getCause() instanceof SecurityException) ? "no_mic" : "engine_error";
                post(() -> call.resolve(fail(why)));
            }
        }, "friday-vosk-init").start();
    }

    private void maybeWake(String hypothesisJson) {
        if (grammar.length == 0) return;
        String q = hypothesisJson.toLowerCase(Locale.ROOT);
        for (String w : grammar) {
            if (q.matches(".*\\b" + java.util.regex.Pattern.quote(w) + "\\b.*")) {
                long now = android.os.SystemClock.elapsedRealtime();
                if (now - lastWakeAt < WAKE_DEBOUNCE_MS) return;
                lastWakeAt = now;
                emit("wake", new JSObject());
                return;
            }
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve(ok());
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean installed;
        try { Class.forName("org.vosk.Model"); installed = true; }
        catch (Throwable t) { installed = false; }
        JSObject r = ok();
        r.put("engine", "vosk");
        r.put("installed", installed);
        r.put("running", service != null);
        r.put("modelPath", activeModelDir);
        r.put("defaultModelPath", defaultModelDir().getAbsolutePath());
        r.put("defaultModelReady", looksLikeModel(defaultModelDir()));
        call.resolve(r);
    }

    @PluginMethod
    public void scanModels(PluginCall call) {
        JSArray out = new JSArray();
        try {
            File[] roots = new File[] {
                new File(getContext().getFilesDir(), "vosk"),
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                getContext().getExternalFilesDir(null)
            };
            for (File root : roots) {
                if (root == null || !root.isDirectory()) continue;
                File[] kids;
                try { kids = root.listFiles(); } catch (Throwable t) { continue; }
                if (kids == null) continue;
                for (File k : kids) {
                    try {
                        if (!k.isDirectory() || !looksLikeModel(k)) continue;
                        JSObject it = new JSObject();
                        it.put("name", k.getName());
                        it.put("path", k.getAbsolutePath());
                        it.put("mb", Math.round(dirSize(k) / 1048576.0));
                        out.put(it);
                    } catch (Throwable ignored) {}
                }
                if (looksLikeModel(root)) {
                    JSObject it = new JSObject();
                    it.put("name", root.getName());
                    it.put("path", root.getAbsolutePath());
                    it.put("mb", Math.round(dirSize(root) / 1048576.0));
                    out.put(it);
                }
            }
        } catch (Throwable ignored) {}
        JSObject r = ok();
        r.put("items", out);
        call.resolve(r);
    }

    private static long dirSize(File f) {
        if (f == null) return 0;
        if (f.isFile()) return f.length();
        long total = 0;
        File[] kids;
        try { kids = f.listFiles(); } catch (Throwable t) { return 0; }
        if (kids == null) return 0;
        for (File k : kids) total += dirSize(k);
        return total;
    }

    /**
     * Disabled legacy Activity-owned downloader. The web layer now queues Vosk
     * through FridayDownloads/WorkManager, which survives Activity and process
     * recreation, resumes .part files, validates the archive, and extracts it
     * into a staging directory before publishing the model path.
     */
    @PluginMethod
    public void downloadModel(final PluginCall call) {
        call.resolve(fail("use_persistent_downloads"));
    }

    private void emit(String event, JSObject data) {
        post(() -> notifyListeners(event, data));
    }

    private void stopInternal() {
        final Object s = service, r = recognizer, m = model;
        service = null; recognizer = null; model = null; activeModelDir = "";
        if (s == null && r == null && m == null) return;
        new Thread(() -> {
            try { if (s != null) s.getClass().getMethod("stop").invoke(s); } catch (Throwable ignored) {}
            try { if (s != null) s.getClass().getMethod("shutdown").invoke(s); } catch (Throwable ignored) {}
            try { if (r != null) r.getClass().getMethod("close").invoke(r); } catch (Throwable ignored) {}
            try { if (m != null) m.getClass().getMethod("close").invoke(m); } catch (Throwable ignored) {}
        }, "friday-vosk-stop").start();
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
    }
}
