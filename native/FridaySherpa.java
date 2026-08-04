package com.rishu.fridayos;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/* vendored sherpa-onnx java-api (Apache-2.0, k2-fsa) - compiled from
   native/vendor/sherpa; the .so natives arrive via native/add_sherpa_dep.py */
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig;

/** v10.0 JARVIS - NEURAL VOICE + OFFLINE EARS (sherpa-onnx).
 *
 *  T1: Piper/VITS or Kokoro neural TTS - FRIDAY stops sounding like a robot,
 *      fully offline. Emits "ttsStart"/"ttsDone" (same contract as
 *      FridaySpeech) so the whole voice pipeline works unchanged.
 *  T2: Moonshine-tiny offline recognizer for dictation & no-network ears.
 *
 *  Every failure path returns a reason - never crashes:
 *    engine_missing (.so not in this build), no_voice / no_stt (model not set),
 *    no_mic (permission), synth_failed / stt_failed.
 *  Voice/STT model files arrive via the generic hfDownload into
 *  filesDir/hfRepo/<pack>/ - the JS side just passes absolute paths. */
@CapacitorPlugin(name = "FridaySherpa")
public class FridaySherpa extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private OfflineTts tts;
    private String ttsLabel = "";
    private OfflineRecognizer rec;
    private String recLabel = "";
    private MediaPlayer player;
    private volatile boolean listening = false;

    private JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }
    private JSObject fail(String why) {
        JSObject o = new JSObject(); o.put("ok", false); o.put("reason", why); return o;
    }

    private boolean nativesOk() {
        try { System.loadLibrary("sherpa-onnx-jni"); return true; }
        catch (Throwable t) { return false; }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = ok();
        r.put("engine", "sherpa");
        r.put("natives", nativesOk());
        r.put("ttsReady", tts != null);
        r.put("ttsLabel", ttsLabel);
        r.put("sttReady", rec != null);
        r.put("sttLabel", recLabel);
        call.resolve(r);
    }

    /* ================= T1 - NEURAL VOICE ================= */

    @PluginMethod
    public void ttsInit(final PluginCall call) {
        final String kind = call.getString("kind", "vits");
        io.submit(() -> {
            try {
                if (!nativesOk()) { call.resolve(fail("engine_missing")); return; }
                closeTts();
                OfflineTtsModelConfig.Builder mb = OfflineTtsModelConfig.builder()
                    .setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2)))
                    .setDebug(false)
                    .setProvider("cpu");
                if ("kokoro".equals(kind)) {
                    mb.setKokoro(OfflineTtsKokoroModelConfig.builder()
                        .setModel(call.getString("modelPath", ""))
                        .setVoices(str(call.getString("voicesPath", "")))
                        .setTokens(str(call.getString("tokensPath", "")))
                        .setLexicon(str(call.getString("lexiconPath", "")))
                        .setDataDir(str(call.getString("dataDir", "")))
                        .setDictDir(str(call.getString("dictDir", "")))
                        .build());
                } else {
                    mb.setVits(OfflineTtsVitsModelConfig.builder()
                        .setModel(str(call.getString("modelPath", "")))
                        .setTokens(str(call.getString("tokensPath", "")))
                        .setLexicon(str(call.getString("lexiconPath", "")))
                        .setDataDir(str(call.getString("dataDir", "")))
                        .setDictDir(str(call.getString("dictDir", "")))
                        .setNoiseScale(0.667f)
                        .setNoiseScaleW(0.8f)
                        .setLengthScale(1.0f)
                        .build());
                }
                tts = new OfflineTts(OfflineTtsConfig.builder()
                    .setModel(mb.build())
                    .setMaxNumSentences(2)
                    .build());
                ttsLabel = kind + ":" + new File(str(call.getString("modelPath", ""))).getName();
                call.resolve(ok().put("sampleRate", tts.getSampleRate()).put("speakers", tts.getNumSpeakers()));
            } catch (UnsatisfiedLinkError noLib) {
                call.resolve(fail("engine_missing"));
            } catch (Throwable t) {
                tts = null;
                call.resolve(fail("init_failed"));
            }
        });
    }

    private static String str(String s) { return s == null ? "" : s; }

    @PluginMethod
    public void speak(final PluginCall call) {
        final String text = call.getString("text", "");
        final int sid = call.getInt("sid", 0);
        final Float speedObj = call.getFloat("speed");
        final float speed = (speedObj == null || speedObj <= 0f) ? 1.0f : speedObj;
        if (text.isEmpty()) { call.resolve(fail("no_text")); return; }
        if (tts == null) { call.resolve(fail("no_voice")); return; }
        io.submit(() -> {
            try {
                GeneratedAudio audio = tts.generate(text, sid, speed);
                final File wav = new File(getContext().getCacheDir(), "sherpa_voice.wav");
                writeWav(wav, audio.getSamples(), audio.getSampleRate());
                main.post(() -> playWav(wav));
                JSObject r = ok();
                r.put("seconds", audio.getSamples().length / (double) audio.getSampleRate());
                call.resolve(r);
            } catch (Throwable t) {
                call.resolve(fail("synth_failed"));
            }
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        stopPlayer();
        call.resolve(ok());
    }

    private void playWav(File wav) {
        stopPlayer();
        try {
            emit("ttsStart");
            player = new MediaPlayer();
            player.setDataSource(wav.getAbsolutePath());
            player.setOnCompletionListener(mp -> { stopPlayer(); emit("ttsDone"); });
            player.setOnErrorListener((mp, what, extra) -> { stopPlayer(); emit("ttsDone"); return true; });
            player.prepare();
            player.start();
        } catch (Throwable t) {
            stopPlayer();
            emit("ttsDone");
        }
    }

    private void stopPlayer() {
        try { if (player != null) { player.stop(); player.release(); } } catch (Throwable ignored) {}
        player = null;
    }

    private void emit(String ev) {
        main.post(() -> notifyListeners(ev, new JSObject()));
    }

    private void closeTts() {
        try { if (tts != null) tts.release(); } catch (Throwable ignored) {}
        tts = null;
    }

    /* minimal PCM16 WAV writer */
    private static void writeWav(File f, float[] samples, int rate) throws Exception {
        byte[] pcm = new byte[samples.length * 2];
        for (int i = 0; i < samples.length; i++) {
            short s = (short) Math.max(-32768, Math.min(32767, (int) (samples[i] * 32767)));
            pcm[i * 2] = (byte) (s & 0xff);
            pcm[i * 2 + 1] = (byte) ((s >> 8) & 0xff);
        }
        try (RandomAccessFile raf = new RandomAccessFile(f, "rw")) {
            raf.setLength(44 + pcm.length);
            writeHeader(raf, pcm.length, rate);
            raf.seek(44);
            raf.write(pcm);
        }
    }

    private static void writeHeader(RandomAccessFile raf, int pcmLen, int rate) throws Exception {
        int byteRate = rate * 2;
        raf.seek(0);
        raf.writeBytes("RIFF"); raf.writeInt(Integer.reverseBytes(36 + pcmLen));
        raf.writeBytes("WAVEfmt "); raf.writeInt(Integer.reverseBytes(16));
        raf.writeShort(Short.reverseBytes((short) 1));
        raf.writeShort(Short.reverseBytes((short) 1));
        raf.writeInt(Integer.reverseBytes(rate));
        raf.writeInt(Integer.reverseBytes(byteRate));
        raf.writeShort(Short.reverseBytes((short) 2));
        raf.writeShort(Short.reverseBytes((short) 16));
        raf.writeBytes("data"); raf.writeInt(Integer.reverseBytes(pcmLen));
    }

    /* ================= T2 - OFFLINE EARS (Moonshine-tiny) ================= */

    @PluginMethod
    public void sttInit(final PluginCall call) {
        final String dir = str(call.getString("modelDir", ""));
        io.submit(() -> {
            try {
                if (!nativesOk()) { call.resolve(fail("engine_missing")); return; }
                closeRec();
                if (dir.isEmpty() || !new File(dir, "tokens.txt").exists()) {
                    call.resolve(fail("no_model_dir")); return;
                }
                rec = new OfflineRecognizer(OfflineRecognizerConfig.builder()
                    .setFeatureConfig(FeatureConfig.builder().setSampleRate(16000).setFeatureDim(80).build())
                    .setOfflineModelConfig(OfflineModelConfig.builder()
                        .setMoonshine(OfflineMoonshineModelConfig.builder()
                            .setPreprocessor(new File(dir, "preprocess.onnx").getAbsolutePath())
                            .setEncoder(new File(dir, "encode.int8.onnx").getAbsolutePath())
                            .setUncachedDecoder(new File(dir, "uncached_decode.int8.onnx").getAbsolutePath())
                            .setCachedDecoder(new File(dir, "cached_decode.int8.onnx").getAbsolutePath())
                            .build())
                        .setTokens(new File(dir, "tokens.txt").getAbsolutePath())
                        .setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2)))
                        .setDebug(false)
                        .setProvider("cpu")
                        .build())
                    .setDecodingMethod("greedy_search")
                    .build());
                recLabel = "moonshine-tiny";
                call.resolve(ok());
            } catch (UnsatisfiedLinkError noLib) {
                call.resolve(fail("engine_missing"));
            } catch (Throwable t) {
                rec = null;
                call.resolve(fail("init_failed"));
            }
        });
    }

    private void closeRec() {
        try { if (rec != null) rec.release(); } catch (Throwable ignored) {}
        rec = null;
    }

    /** Record until ~1.3s of trailing silence (max 15s), decode, return text. */
    @PluginMethod
    public void listenOnce(final PluginCall call) {
        if (rec == null) { call.resolve(fail("no_stt")); return; }
        if (getContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) { call.resolve(fail("no_mic")); return; }
        if (listening) { call.resolve(fail("busy")); return; }
        io.submit(() -> {
            listening = true;
            AudioRecord ar = null;
            try {
                int min = AudioRecord.getMinBufferSize(16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                ar = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 6400));
                emit("sttStart");
                java.util.ArrayList<float[]> chunks = new java.util.ArrayList<>();
                short[] buf = new short[1600];               // 100ms
                ar.startRecording();
                long started = System.currentTimeMillis();
                long silenceStart = -1;
                boolean heardSpeech = false;
                while (System.currentTimeMillis() - started < 15000 && listening) {
                    int n = ar.read(buf, 0, buf.length);
                    if (n <= 0) continue;
                    float[] f = new float[n];
                    double energy = 0;
                    for (int i = 0; i < n; i++) { f[i] = buf[i] / 32768.0f; energy += f[i] * f[i]; }
                    chunks.add(f);
                    double rms = Math.sqrt(energy / n);
                    if (rms > 0.012) { heardSpeech = true; silenceStart = -1; }
                    else if (heardSpeech) {
                        if (silenceStart < 0) silenceStart = System.currentTimeMillis();
                        else if (System.currentTimeMillis() - silenceStart > 1300) break;
                    }
                }
                try { ar.stop(); } catch (Throwable ignored) {}
                int total = 0;
                for (float[] c : chunks) total += c.length;
                float[] all = new float[total];
                int pos = 0;
                for (float[] c : chunks) { System.arraycopy(c, 0, all, pos, c.length); pos += c.length; }

                OfflineStream stream = rec.createStream();
                stream.acceptWaveform(all, 16000);
                rec.decode(stream);
                String text = rec.getResult(stream).getText().trim();
                stream.release();
                listening = false;
                emit("sttEnd");
                if (text.isEmpty()) { call.resolve(fail(heardSpeech ? "empty" : "silence")); return; }
                call.resolve(ok().put("text", text));
            } catch (SecurityException se) {
                listening = false; emit("sttEnd");
                call.resolve(fail("no_mic"));
            } catch (Throwable t) {
                listening = false; emit("sttEnd");
                call.resolve(fail("stt_failed"));
            } finally {
                try { if (ar != null) ar.release(); } catch (Throwable ignored) {}
            }
        });
    }

    @PluginMethod
    public void stopListen(PluginCall call) {
        listening = false;
        call.resolve(ok());
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        stopPlayer();
        io.submit(() -> { closeTts(); closeRec(); });
    }
}
