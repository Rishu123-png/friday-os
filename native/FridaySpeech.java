package com.rishu.fridayos;

import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Native speech for FRIDAY.
 *
 * Android WebView has NO speechSynthesis and NO webkitSpeechRecognition,
 * so the web APIs silently do nothing inside the APK. This plugin wires the
 * real Android TextToSpeech + SpeechRecognizer engines instead.
 */
@CapacitorPlugin(name = "FridaySpeech")
public class FridaySpeech extends Plugin {

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private SpeechRecognizer recognizer;
    private boolean listening = false;

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String w) { JSObject o = new JSObject(); o.put("ok", false); o.put("reason", w); return o; }

    /* ==================== TEXT TO SPEECH ==================== */

    @PluginMethod
    public void initTTS(final PluginCall call) {
        if (ttsReady) { call.resolve(ok()); return; }
        try {
            tts = new TextToSpeech(getContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    ttsReady = (status == TextToSpeech.SUCCESS);
                    if (ttsReady) {
                        tts.setLanguage(Locale.US);
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) {
                                notifyListeners("ttsStart", new JSObject());
                            }
                            @Override public void onDone(String id) {
                                notifyListeners("ttsDone", new JSObject());
                            }
                            @Override public void onError(String id) {
                                notifyListeners("ttsDone", new JSObject());
                            }
                        });
                    }
                    JSObject r = new JSObject();
                    r.put("ok", ttsReady);
                    call.resolve(r);
                }
            });
        } catch (Exception e) {
            call.resolve(fail(e.getMessage()));
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty()) { call.resolve(fail("empty")); return; }
        if (!ttsReady || tts == null) { call.resolve(fail("not_ready")); return; }

        try {
            float rate  = (float) call.getDouble("rate", 1.0d).doubleValue();
            float pitch = (float) call.getDouble("pitch", 1.1d).doubleValue();
            String lang = call.getString("lang", "en-US");

            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            try {
                String[] p = lang.split("-");
                tts.setLanguage(p.length > 1 ? new Locale(p[0], p[1]) : new Locale(p[0]));
            } catch (Exception ignored) {}

            // Prefer a female voice so FRIDAY sounds right
            try {
                Set<Voice> vs = tts.getVoices();
                if (vs != null) {
                    for (Voice v : vs) {
                        String n = v.getName().toLowerCase();
                        if (v.getLocale() != null
                                && v.getLocale().getLanguage().equals(lang.split("-")[0])
                                && (n.contains("female") || n.contains("#f") || n.endsWith("-local-f"))) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}

            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "friday-" + System.currentTimeMillis());
            call.resolve(ok());
        } catch (Exception e) {
            call.resolve(fail(e.getMessage()));
        }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        try { if (tts != null) tts.stop(); } catch (Exception ignored) {}
        call.resolve(ok());
    }

    @PluginMethod
    public void isSpeaking(PluginCall call) {
        JSObject r = ok();
        r.put("speaking", tts != null && tts.isSpeaking());
        call.resolve(r);
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        JSArray arr = new JSArray();
        try {
            if (tts != null && tts.getVoices() != null) {
                for (Voice v : tts.getVoices()) {
                    JSObject o = new JSObject();
                    o.put("name", v.getName());
                    o.put("lang", v.getLocale() != null ? v.getLocale().toString() : "");
                    arr.put(o);
                }
            }
        } catch (Exception ignored) {}
        JSObject r = ok(); r.put("voices", arr); call.resolve(r);
    }

    /* ==================== SPEECH RECOGNITION ==================== */

    @PluginMethod
    public void startListening(final PluginCall call) {
        final String lang = call.getString("lang", "en-US");
        final boolean partial = call.getBoolean("partial", true);

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                        call.resolve(fail("unavailable"));
                        return;
                    }
                    if (recognizer != null) {
                        try { recognizer.destroy(); } catch (Exception ignored) {}
                    }
                    recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                    recognizer.setRecognitionListener(new RecognitionListener() {
                        @Override public void onReadyForSpeech(Bundle b) {
                            listening = true;
                            notifyListeners("sttStart", new JSObject());
                        }
                        @Override public void onBeginningOfSpeech() {}
                        @Override public void onRmsChanged(float v) {
                            JSObject o = new JSObject();
                            o.put("rms", v);
                            notifyListeners("sttLevel", o);
                        }
                        @Override public void onBufferReceived(byte[] b) {}
                        @Override public void onEndOfSpeech() {}

                        @Override public void onError(int err) {
                            listening = false;
                            JSObject o = new JSObject();
                            o.put("error", errName(err));
                            notifyListeners("sttError", o);
                        }

                        @Override public void onResults(Bundle results) {
                            listening = false;
                            ArrayList<String> m = results.getStringArrayList(
                                    SpeechRecognizer.RESULTS_RECOGNITION);
                            JSObject o = new JSObject();
                            o.put("text", (m != null && !m.isEmpty()) ? m.get(0) : "");
                            notifyListeners("sttResult", o);
                        }

                        @Override public void onPartialResults(Bundle results) {
                            if (!partial) return;
                            ArrayList<String> m = results.getStringArrayList(
                                    SpeechRecognizer.RESULTS_RECOGNITION);
                            if (m == null || m.isEmpty()) return;
                            JSObject o = new JSObject();
                            o.put("text", m.get(0));
                            notifyListeners("sttPartial", o);
                        }

                        @Override public void onEvent(int t, Bundle b) {}
                    });

                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
                    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE,
                            getContext().getPackageName());
                    // offline where the device supports it
                    i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);

                    recognizer.startListening(i);
                    call.resolve(ok());
                } catch (Exception e) {
                    listening = false;
                    call.resolve(fail(e.getMessage()));
                }
            }
        });
    }

    @PluginMethod
    public void stopListening(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                try { if (recognizer != null) recognizer.stopListening(); } catch (Exception ignored) {}
                listening = false;
                call.resolve(ok());
            }
        });
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        JSObject r = ok();
        r.put("listening", listening);
        call.resolve(r);
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = ok();
        boolean stt = false;
        try { stt = SpeechRecognizer.isRecognitionAvailable(getContext()); } catch (Exception ignored) {}
        r.put("stt", stt);
        r.put("tts", ttsReady);
        call.resolve(r);
    }

    private String errName(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";
            case SpeechRecognizer.ERROR_NO_MATCH: return "no-speech";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case SpeechRecognizer.ERROR_SERVER: return "server";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            default: return "unknown";
        }
    }

    @Override
    protected void handleOnDestroy() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception ignored) {}
        try { if (recognizer != null) recognizer.destroy(); } catch (Exception ignored) {}
        super.handleOnDestroy();
    }
}
