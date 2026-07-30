package com.rishu.fridayos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Offline LLM inference for FRIDAY (llama.cpp).
 *
 * Exposes: loadModel(filePath, nCtx, nThreads, nGpuLayers)
 *          generate(prompt, stream, temperature, topP, topK,
 *                   repeatPenalty, nPredict, stop[])
 *              -> resolves {text}, streams tokens as "token" events
 *          abort()
 *          unloadModel()
 *          status()   -> {loaded, modelPath, maxRamMB, freeRamMB}
 *
 * The actual engine lives in LlamaEngine.java so the llama.cpp binding
 * can be swapped without touching the plugin. If the binding is not
 * bundled (see native/llama_setup.md), calls reject with
 * LLAMA_BINDING_MISSING and the web app degrades to templates/Groq.
 */
@CapacitorPlugin(name = "LlamaCpp")
public class LlamaCpp extends Plugin {

    private final LlamaEngine engine = new LlamaEngine();
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private static float getFloat(PluginCall call, String key, float def) {
        Double d = call.getDouble(key);
        return d != null ? d.floatValue() : def;
    }

    @PluginMethod
    public void loadModel(final PluginCall call) {
        final String path = call.getString("filePath", "");
        final int nCtx = call.getInt("nCtx", 4096);
        final int nThreads = call.getInt("nThreads", 4);
        final int nGpu = call.getInt("nGpuLayers", 0);
        if (path.isEmpty()) { call.reject("filePath required"); return; }
        io.submit(() -> {
            try {
                engine.load(path, nCtx, nThreads, nGpu);
                call.resolve(new JSObject().put("ok", true));
            } catch (ClassNotFoundException e) {
                call.reject("LLAMA_BINDING_MISSING - add the llama.cpp dependency (see native/llama_setup.md)");
            } catch (Throwable t) {
                call.reject(t.getMessage(), t);
            }
        });
    }

    @PluginMethod
    public void unloadModel(final PluginCall call) {
        io.submit(() -> {
            try { engine.unload(); } catch (Throwable ignored) {}
            call.resolve(new JSObject().put("ok", true));
        });
    }

    @PluginMethod
    public void generate(final PluginCall call) {
        final String prompt = call.getString("prompt", "");
        if (prompt.isEmpty()) { call.reject("prompt required"); return; }

        final float temp  = getFloat(call, "temperature", 0.2f);
        final float topP  = getFloat(call, "topP", 0.95f);
        final int   topK  = call.getInt("topK", 40);
        final float repPn = getFloat(call, "repeatPenalty", 1.1f);
        final int   nPred = call.getInt("nPredict", 1024);
        final boolean stream = call.getBoolean("stream", true);

        final ArrayList<String> stopList = new ArrayList<>();
        try {
            JSArray arr = call.getArray("stop");
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                Object v = arr.get(i);
                if (v != null) stopList.add(String.valueOf(v));
            }
        } catch (Throwable ignored) {}

        io.submit(() -> {
            try {
                String text = engine.generate(prompt, temp, topP, topK, repPn, nPred, stopList,
                    stream ? token -> {
                        JSObject o = new JSObject();
                        o.put("text", token);
                        notifyListeners("token", o);
                    } : null);
                call.resolve(new JSObject().put("text", text));
            } catch (ClassNotFoundException e) {
                call.reject("LLAMA_BINDING_MISSING - add the llama.cpp dependency (see native/llama_setup.md)");
            } catch (Throwable t) {
                call.reject(t.getMessage(), t);
            }
        });
    }

    @PluginMethod
    public void abort(final PluginCall call) {
        engine.abort();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void status(final PluginCall call) {
        Runtime rt = Runtime.getRuntime();
        JSObject r = new JSObject();
        r.put("loaded", engine.isLoaded());
        r.put("modelPath", engine.loadedPath());
        r.put("maxRamMB", rt.maxMemory() / 1048576);
        r.put("freeRamMB", rt.freeMemory() / 1048576);
        call.resolve(r);
    }
}
