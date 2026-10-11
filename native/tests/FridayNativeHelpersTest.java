package com.rishu.fridayos;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

/**
 * FRIDAY OS — pure helper coverage for the native layer.
 *
 * <p>The native layer is ~7,800 lines across 29 classes and previously had two
 * test classes. These helpers are the parts that decide whether a downloaded
 * model is usable, whether a file is big enough to trust, how large an on-disk
 * directory is, and how a language tag is normalised before it is handed to an
 * engine. They are all pure or File-based, so they can be verified without an
 * emulator — which is exactly why they should be.
 *
 * <p>Every one of these guards a real failure mode: a truncated download, a
 * half-extracted archive, a path that does not exist, or a null that used to
 * crash the plugin.
 */
public class FridayNativeHelpersTest {

    private static Method priv(Class<?> owner, String name, Class<?>... sig) throws Exception {
        Method m = owner.getDeclaredMethod(name, sig);
        m.setAccessible(true);
        return m;
    }

    /* ================= FridayReminderScheduler.notificationId ============== */

    /**
     * Reminder notification ids must be stable (so an update replaces the
     * right notification instead of stacking a duplicate) and must live inside
     * the app's reserved 0x46xxxxxx range so they can never collide with the
     * foreground-service or call-guard notifications.
     */
    @Test public void reminderNotificationIdIsDeterministicAndNamespaced() {
        int a = FridayReminderScheduler.notificationId("rem-42");
        int b = FridayReminderScheduler.notificationId("rem-42");
        assertEquals("same id must hash to the same notification id", a, b);
        assertEquals("must stay in the 0x46 namespace", 0x46000000, a & 0xff000000);
    }

    @Test public void reminderNotificationIdSpreadsAcrossIds() {
        assertNotEquals(FridayReminderScheduler.notificationId("a"),
                FridayReminderScheduler.notificationId("b"));
        assertNotEquals(FridayReminderScheduler.notificationId("rem-1"),
                FridayReminderScheduler.notificationId("rem-2"));
    }

    @Test public void reminderNotificationIdSurvivesNullAndEmpty() {
        // must not throw — a missing id should never take the scheduler down
        int fromNull = FridayReminderScheduler.notificationId(null);
        int fromEmpty = FridayReminderScheduler.notificationId("");
        assertEquals(fromNull, fromEmpty);
        assertEquals(0x46000000, fromNull & 0xff000000);
    }

    /* ===================== FridayVosk.looksLikeModel ====================== */

    /**
     * Vosk rejects the model unless the nested acoustic-model file exists. This
     * check is what stops the wake word from arming against a half-downloaded
     * folder and then silently never hearing anything.
     */
    @Test public void voskModelRequiresTheNestedAcousticFile() throws Exception {
        Method looks = priv(FridayVosk.class, "looksLikeModel", File.class);

        File empty = tmpDir("vosk-empty");
        assertEquals(false, looks.invoke(null, empty));

        File proper = tmpDir("vosk-proper");
        File am = new File(proper, "am");
        assertTrue(am.mkdirs());
        assertTrue(new File(am, "final.mdl").createNewFile());
        assertEquals(true, looks.invoke(null, proper));
    }

    @Test public void voskModelRejectsNullOrAFile() throws Exception {
        Method looks = priv(FridayVosk.class, "looksLikeModel", File.class);
        assertEquals(false, looks.invoke(null, new Object[]{null}));

        File f = File.createTempFile("not-a-dir", ".txt");
        f.deleteOnExit();
        assertEquals(false, looks.invoke(null, f));
    }

    /* ======================= FridayVosk.dirSize =========================== */

    @Test public void voskDirSizeSumsNestedFiles() throws Exception {
        Method size = priv(FridayVosk.class, "dirSize", File.class);

        File root = tmpDir("vosk-size");
        write(new File(root, "a.bin"), 120);
        File sub = new File(root, "am");
        assertTrue(sub.mkdirs());
        write(new File(sub, "final.mdl"), 340);

        assertEquals(460L, size.invoke(null, root));
    }

    @Test public void voskDirSizeHandlesNullFileAndPlainFile() throws Exception {
        Method size = priv(FridayVosk.class, "dirSize", File.class);
        assertEquals(0L, size.invoke(null, new Object[]{null}));

        File f = File.createTempFile("plain", ".bin");
        f.deleteOnExit();
        write(f, 77);
        assertEquals(77L, size.invoke(null, f));
    }

    /* ==================== FridaySherpa.fileOk / dirOk ===================== */

    /**
     * fileOk() gates every Sherpa asset — the encoder, the decoder, the tokens
     * file. The minimum-size threshold is what catches a truncated or
     * error-page download that is technically "a file" but useless.
     */
    @Test public void sherpaFileOkEnforcesTheMinimumSize() throws Exception {
        Method fileOk = priv(FridaySherpa.class, "fileOk", String.class, long.class);

        File f = File.createTempFile("sherpa", ".onnx");
        f.deleteOnExit();
        write(f, 100);

        assertEquals(true, fileOk.invoke(null, f.getAbsolutePath(), 50L));
        assertEquals(true, fileOk.invoke(null, f.getAbsolutePath(), 100L));
        assertEquals(false, fileOk.invoke(null, f.getAbsolutePath(), 101L));
    }

    @Test public void sherpaFileOkRejectsMissingEmptyAndNullPaths() throws Exception {
        Method fileOk = priv(FridaySherpa.class, "fileOk", String.class, long.class);
        assertEquals(false, fileOk.invoke(null, new Object[]{null, 1L}));
        assertEquals(false, fileOk.invoke(null, "", 1L));
        assertEquals(false, fileOk.invoke(null, "/no/such/sherpa/asset.onnx", 1L));
    }

    @Test public void sherpaDirOkRequiresANonEmptyDirectory() throws Exception {
        Method dirOk = priv(FridaySherpa.class, "dirOk", String.class);

        File empty = tmpDir("sherpa-empty");
        assertEquals(false, dirOk.invoke(null, empty.getAbsolutePath()));

        File populated = tmpDir("sherpa-full");
        write(new File(populated, "tokens.txt"), 10);
        assertEquals(true, dirOk.invoke(null, populated.getAbsolutePath()));

        // a file is not a directory, however large it is
        assertEquals(false, dirOk.invoke(null, new File(populated, "tokens.txt").getAbsolutePath()));
    }

    @Test public void sherpaDirOkRejectsNullOrEmptyPath() throws Exception {
        Method dirOk = priv(FridaySherpa.class, "dirOk", String.class);
        assertEquals(false, dirOk.invoke(null, new Object[]{null}));
        assertEquals(false, dirOk.invoke(null, ""));
    }

    /* ======================== FridaySherpa.str ============================ */

    @Test public void sherpaStrNeverReturnsNull() throws Exception {
        Method str = priv(FridaySherpa.class, "str", String.class);
        assertEquals("", str.invoke(null, new Object[]{null}));
        assertEquals("", str.invoke(null, ""));
        assertEquals("friday", str.invoke(null, "friday"));
    }

    /* ===================== FridayTranslate.normTag ======================== */

    /**
     * Language tags go straight into an engine lookup. Normalising them here is
     * what makes "EN-in", " en-IN " and "en-in" all resolve to the same model
     * instead of three separate misses.
     */
    @Test public void translateNormTagLowercasesAndTrims() throws Exception {
        Method norm = priv(FridayTranslate.class, "normTag", String.class);
        assertEquals("en-in", norm.invoke(null, "EN-IN"));
        assertEquals("en-in", norm.invoke(null, "  en-IN  "));
        assertEquals("hi", norm.invoke(null, "HI"));
    }

    @Test public void translateNormTagNeverReturnsNull() throws Exception {
        Method norm = priv(FridayTranslate.class, "normTag", String.class);
        assertEquals("", norm.invoke(null, new Object[]{null}));
        assertEquals("", norm.invoke(null, ""));
    }

    /* ---------- tiny filesystem helpers ---------- */

    private static File tmpDir(String name) throws Exception {
        File d = new File(System.getProperty("java.io.tmpdir"), "friday-test-" + name + "-" + System.nanoTime());
        if (d.exists()) deleteRec(d);
        assertTrue("could not create " + d, d.mkdirs());
        d.deleteOnExit();
        return d;
    }

    private static void write(File f, int bytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(new byte[bytes]);
        }
    }

    private static void deleteRec(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
