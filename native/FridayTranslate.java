package com.rishu.fridayos;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Proxy;
import java.util.Locale;

/** Offline on-device translator (Google ML Kit), fully reflection-based.
 *
 *  Why reflection: the AARs (com.google.mlkit:translate + language-id) are
 *  bundled by native/add_llama_dep.py; a build without them resolves
 *  ok:false / reason:"not_installed" and the JS side answers via Groq/web
 *  instead. ML Kit itself downloads per-language packs on demand through
 *  Play Services - first use per language pair needs internet once, then
 *  it is 100% offline. 50+ languages incl Hindi/Marathi/Tamil/Telugu/Urdu.
 */
@CapacitorPlugin(name = "FridayTranslate")
public class FridayTranslate extends Plugin {

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) {
        JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean installed;
        try { Class.forName("com.google.mlkit.nl.translate.Translation"); installed = true; }
        catch (Throwable t) { installed = false; }
        call.resolve(ok().put("installed", installed).put("engine", "mlkit"));
    }

    @PluginMethod
    public void identify(PluginCall call) {
        final String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) { call.resolve(fail("no_text")); return; }
        try {
            Class<?> lidCls = Class.forName("com.google.mlkit.nl.languageid.LanguageIdentification");
            Object lid = lidCls.getMethod("getClient").invoke(null);
            Object task = lid.getClass().getMethod("identifyLanguage", String.class).invoke(lid, text);
            attach(task,
                v -> {
                    String lang = String.valueOf(v);
                    if ("und".equals(lang)) { call.resolve(fail("unknown_lang")); return; }
                    call.resolve(ok().put("lang", lang));
                },
                e -> call.resolve(fail("identify_failed")));
        } catch (ClassNotFoundException noAar) {
            call.resolve(fail("not_installed"));
        } catch (Throwable t) {
            call.resolve(fail("identify_failed"));
        }
    }

    @PluginMethod
    public void translate(PluginCall call) {
        final String text = call.getString("text", "");
        final String to = normTag(call.getString("to", "hi"));
        String from = normTag(call.getString("from", ""));
        if (text == null || text.trim().isEmpty()) { call.resolve(fail("no_text")); return; }
        if (to.isEmpty()) { call.resolve(fail("bad_target")); return; }

        if (from.isEmpty()) {
            /* detect first, then translate with the detected source */
            try {
                Class<?> lidCls = Class.forName("com.google.mlkit.nl.languageid.LanguageIdentification");
                Object lid = lidCls.getMethod("getClient").invoke(null);
                Object task = lid.getClass().getMethod("identifyLanguage", String.class).invoke(lid, text);
                attach(task,
                    v -> {
                        String lang = normTag(String.valueOf(v));
                        if (lang.isEmpty() || "und".equals(lang)) doTranslate(call, text, "hi", to);
                        else doTranslate(call, text, lang, to);
                    },
                    e -> doTranslate(call, text, "hi", to));
            } catch (ClassNotFoundException noAar) {
                call.resolve(fail("not_installed"));
            } catch (Throwable t) {
                call.resolve(fail("identify_failed"));
            }
        } else {
            doTranslate(call, text, from, to);
        }
    }

    private void doTranslate(PluginCall call, String text, String from, String to) {
        if (from.equals(to)) { call.resolve(ok().put("text", text).put("from", from).put("to", to).put("same", true)); return; }
        try {
            Class<?> optCls = Class.forName("com.google.mlkit.nl.translate.TranslatorOptions");
            Class<?> bCls = Class.forName("com.google.mlkit.nl.translate.TranslatorOptions$Builder");
            Object builder = bCls.getDeclaredConstructor().newInstance();
            bCls.getMethod("setSourceLanguage", String.class).invoke(builder, from);
            bCls.getMethod("setTargetLanguage", String.class).invoke(builder, to);
            Object opts = bCls.getMethod("build").invoke(builder);

            Class<?> trCls = Class.forName("com.google.mlkit.nl.translate.Translation");
            Object client = trCls.getMethod("getClient", optCls).invoke(null, opts);
            Object task = client.getClass().getMethod("translate", String.class).invoke(client, text);
            attach(task,
                v -> call.resolve(ok().put("text", String.valueOf(v)).put("from", from).put("to", to)),
                e -> call.resolve(fail("translate_failed")));
        } catch (ClassNotFoundException noAar) {
            call.resolve(fail("not_installed"));
        } catch (Throwable t) {
            call.resolve(fail("translate_failed"));
        }
    }

    /* gms Task<T> -> JS callbacks via reflection proxies */
    private interface OkCb { void run(Object v); }
    private interface ErrCb { void run(Object e); }

    private void attach(Object task, OkCb onOk, ErrCb onErr) throws Exception {
        Class<?> okLis = Class.forName("com.google.android.gms.tasks.OnSuccessListener");
        Class<?> errLis = Class.forName("com.google.android.gms.tasks.OnFailureListener");
        Object okProxy = Proxy.newProxyInstance(okLis.getClassLoader(), new Class<?>[] { okLis },
            (p, m, a) -> { try { onOk.run(a != null && a.length > 0 ? a[0] : null); } catch (Throwable ignored) {} return null; });
        Object errProxy = Proxy.newProxyInstance(errLis.getClassLoader(), new Class<?>[] { errLis },
            (p, m, a) -> { try { onErr.run(a != null && a.length > 0 ? a[0] : null); } catch (Throwable ignored) {} return null; });
        task.getClass().getMethod("addOnSuccessListener", okLis).invoke(task, okProxy);
        task.getClass().getMethod("addOnFailureListener", errLis).invoke(task, errProxy);
    }

    private static String normTag(String tag) {
        if (tag == null) return "";
        return tag.toLowerCase(Locale.ROOT).trim();
    }
}
