package com.rishu.fridayos;

import java.lang.reflect.Method;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Thin adapter over a llama.cpp Java binding.
 *
 * Default target: de.kherud:llama (java-llama.cpp) - see native/llama_setup.md.
 * Reflection is used deliberately: setter names have shifted across versions
 * of that library (setNThreads vs setThreads...), and this file is the ONLY
 * place that depends on the binding. Swap in your own JNI build by replacing
 * this one file - LlamaCpp.java and the whole web app stay untouched.
 *
 * If the binding classes are absent, load()/generate() throw
 * ClassNotFoundException, which LlamaCpp turns into LLAMA_BINDING_MISSING
 * and the web app degrades gracefully.
 */
public class LlamaEngine {

    public interface TokenSink { void on(String token); }

    private Object model;              // de.kherud.llama.LlamaModel
    private String loadedPath = null;
    private final AtomicBoolean abort = new AtomicBoolean(false);

    public boolean isLoaded() { return model != null; }
    public String loadedPath() { return loadedPath; }

    /* ---------- reflection helpers ---------- */
    private static void invokeBest(Object target, String[] names, Class<?>[] sig, Object... args) {
        for (String n : names) {
            try {
                Method m = target.getClass().getMethod(n, sig);
                m.invoke(target, args);
                return;
            } catch (Throwable ignored) {}
        }
    }

    /* ---------- lifecycle ---------- */
    public synchronized void load(String path, int nCtx, int nThreads, int nGpuLayers) throws Exception {
        unload();

        Class<?> mpClass = Class.forName("de.kherud.llama.ModelParameters");
        Object params = mpClass.getDeclaredConstructor().newInstance();
        invokeBest(params, new String[]{"setModel", "setModelPath"}, new Class[]{String.class}, path);
        invokeBest(params, new String[]{"setContextSize", "setNCtx", "setNumCtx"}, new Class[]{int.class}, nCtx);
        if (nThreads > 0)
            invokeBest(params, new String[]{"setThreads", "setNThreads"}, new Class[]{int.class}, nThreads);
        if (nGpuLayers > 0)
            invokeBest(params, new String[]{"setGpuLayers", "setNGpuLayers"}, new Class[]{int.class}, nGpuLayers);
        invokeBest(params, new String[]{"setUseMmap"}, new Class[]{boolean.class}, true);
        invokeBest(params, new String[]{"setUseMlock"}, new Class[]{boolean.class}, false);

        Class<?> lmClass = Class.forName("de.kherud.llama.LlamaModel");
        model = lmClass.getDeclaredConstructor(mpClass).newInstance(params);
        loadedPath = path;
    }

    public synchronized void unload() {
        if (model != null) {
            try { model.getClass().getMethod("close").invoke(model); } catch (Throwable ignored) {}
            model = null;
            loadedPath = null;
        }
    }

    /* ================= v10.0 M1: embedding brain (semantic memory) ================= */
    private Object embedModel;
    private String embedPath;

    public synchronized void loadEmbed(String path) throws Exception {
        if (embedModel != null && path.equals(embedPath)) return;
        unloadEmbed();

        Class<?> mpClass = Class.forName("de.kherud.llama.ModelParameters");
        Object params = mpClass.getDeclaredConstructor().newInstance();
        invokeBest(params, new String[]{"setModel", "setModelPath"}, new Class[]{String.class}, path);
        invokeBest(params, new String[]{"setContextSize", "setNCtx", "setNumCtx"}, new Class[]{int.class}, 512);
        invokeBest(params, new String[]{"setThreads", "setNThreads"}, new Class[]{int.class}, 4);
        invokeBest(params, new String[]{"setEmbedding", "setEmbeddings"}, new Class[]{boolean.class}, true);
        invokeBest(params, new String[]{"setUseMmap"}, new Class[]{boolean.class}, true);
        invokeBest(params, new String[]{"setUseMlock"}, new Class[]{boolean.class}, false);

        Class<?> lmClass = Class.forName("de.kherud.llama.LlamaModel");
        embedModel = lmClass.getDeclaredConstructor(mpClass).newInstance(params);
        embedPath = path;
    }

    public synchronized void unloadEmbed() {
        if (embedModel != null) {
            try { embedModel.getClass().getMethod("close").invoke(embedModel); } catch (Throwable ignored) {}
            embedModel = null;
            embedPath = null;
        }
    }

    public boolean embedLoaded() { return embedModel != null; }
    public String embedLoadedPath() { return embedPath; }

    public synchronized float[] embed(String text) throws Exception {
        if (embedModel == null) throw new IllegalStateException("no_embed_model");
        return (float[]) embedModel.getClass().getMethod("embed", String.class).invoke(embedModel, text);
    }

    public void abort() { abort.set(true); }

    /* ---------- inference ---------- */
    public synchronized String generate(String prompt,
                                        float temperature, float topP, int topK,
                                        float repeatPenalty, int nPredict,
                                        List<String> stops,
                                        TokenSink sink) throws Exception {
        if (model == null) throw new IllegalStateException("no_model_loaded");
        abort.set(false);

        Class<?> ipClass = Class.forName("de.kherud.llama.InferenceParameters");
        Object infer = ipClass.getDeclaredConstructor(String.class).newInstance(prompt);
        invokeBest(infer, new String[]{"setTemperature"}, new Class[]{float.class}, temperature);
        invokeBest(infer, new String[]{"setTopP"}, new Class[]{float.class}, topP);
        invokeBest(infer, new String[]{"setTopK"}, new Class[]{int.class}, topK);
        invokeBest(infer, new String[]{"setRepeatPenalty"}, new Class[]{float.class}, repeatPenalty);
        invokeBest(infer, new String[]{"setNPredict", "setMaxTokens", "setNumPredict"}, new Class[]{int.class}, nPredict);
        if (stops != null && !stops.isEmpty()) {
            invokeBest(infer, new String[]{"setStopStrings", "setAntiPrompt"},
                    new Class[]{String[].class}, (Object) stops.toArray(new String[0]));
        }

        Object result = model.getClass().getMethod("generate", ipClass).invoke(model, infer);

        StringBuilder sb = new StringBuilder();
        if (result instanceof Iterable) {
            for (Object out : (Iterable<?>) result) {
                if (abort.get()) break;
                String t = String.valueOf(out);
                sb.append(t);
                if (sink != null) sink.on(t);
            }
        } else if (result != null) {
            sb.append(result);
        }
        return sb.toString().trim();
    }
}
