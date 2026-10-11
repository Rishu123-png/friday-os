package com.rishu.fridayos;

import org.junit.Test;

import java.io.File;
import java.io.FileWriter;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

/**
 * FRIDAY OS — crash-report redaction and bounded I/O.
 *
 * <p>FridayDiagnostics.sanitize() is the last line of defence between a runtime
 * exception that happens to contain a credential and a plaintext crash log
 * sitting on the user's filesystem. Stack traces and provider error bodies
 * routinely embed Authorization headers and API keys, so if any one of these
 * regexes silently stops matching, a real key ends up written to disk where a
 * backup or another app can read it.
 *
 * <p>These tests pin that behaviour down. They reach private statics through
 * reflection on purpose: the helpers are implementation details, but the
 * redaction is a security property, and a security property that is not tested
 * is a security property that will regress.
 */
public class FridayDiagnosticsTest {

    /* ---------- reflection helpers ---------- */

    private static Method priv(String name, Class<?>... sig) throws Exception {
        Method m = FridayDiagnostics.class.getDeclaredMethod(name, sig);
        m.setAccessible(true);
        return m;
    }

    private static String sanitize(String in) throws Exception {
        return (String) priv("sanitize", String.class).invoke(null, in);
    }

    /* ---------- the redaction contract ---------- */

    @Test public void stripsBearerAuthorizationHeader() throws Exception {
        String out = sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.oaijhgf.xyz");
        assertTrue("redaction marker missing: " + out, out.contains("[REDACTED]"));
        assertFalse("token leaked: " + out, out.contains("eyJhbGciOiJIUzI1NiJ9"));
    }

    @Test public void stripsLowercaseBearerAuthorizationHeader() throws Exception {
        String out = sanitize("authorization=bearer sk-live-9f8e7d6c5b4a3210");
        assertFalse("token leaked: " + out, out.contains("sk-live-9f8e7d6c5b4a3210"));
    }

    @Test public void stripsGroqShapedKeyAnywhereInTheText() throws Exception {
        String key = "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";
        String out = sanitize("provider error: rejected key " + key + " with 401");
        assertFalse("groq key leaked: " + out, out.contains("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"));
        assertTrue("marker missing: " + out, out.contains("[REDACTED_KEY]"));
    }

    @Test public void stripsDashPrefixedKey() throws Exception {
        String out = sanitize("body={\"key\":\"sk-abcdef0123456789abcdef\"}");
        assertFalse("dash key leaked: " + out, out.contains("sk-abcdef0123456789abcdef"));
    }

    @Test public void stripsNamedCredentialsInAssignmentForm() throws Exception {
        assertFalse(sanitize("api_key=AIzaSyD-1234567890abcdefXYZ").contains("AIzaSyD-1234567890abcdefXYZ"));
        assertFalse(sanitize("apiKey: 9f8e7d6c5b4a32109f8e7d6c5b4a3210").contains("9f8e7d6c5b4a32109f8e7d6c5b4a3210"));
        assertFalse(sanitize("TOKEN=hk_live_7d8e9f0a1b2c3d4e").contains("hk_live_7d8e9f0a1b2c3d4e"));
        assertFalse(sanitize("secret = hunter2hunter2hunter2").contains("hunter2hunter2hunter2"));
        assertFalse(sanitize("password: correct-horse-battery").contains("correct-horse-battery"));
    }

    @Test public void stripsQueryStringCredentials() throws Exception {
        String out = sanitize("GET https://api.example.com/v1?token=abc123def456&x=1");
        assertFalse("query token leaked: " + out, out.contains("abc123def456"));
        assertTrue("unrelated param was eaten: " + out, out.contains("x=1"));
    }

    /* ---------- redaction must not destroy the diagnostic value ---------- */

    @Test public void keepsTheKeyNameSoTheLogIsStillUseful() throws Exception {
        String out = sanitize("api_key=AIzaSyD-1234567890abcdefXYZ");
        assertTrue("the reason for the failure was lost: " + out, out.contains("api_key"));
    }

    @Test public void leavesOrdinaryProseUntouched() throws Exception {
        String plain = "java.lang.NullPointerException at FridayService.java:174";
        assertEquals(plain, sanitize(plain));
    }

    @Test public void leavesShortTokensAloneSoStackFramesSurvive() throws Exception {
        String frame = "at com.rishu.fridayos.FridayNative.onCreate(FridayNative.java:88)";
        assertEquals(frame, sanitize(frame));
    }

    /**
     * A crash reporter that throws while reporting a crash is worse than no
     * crash reporter at all. This used to be a NullPointerException inside
     * sanitize() itself — caught by this test.
     */
    @Test public void nullLineReturnsEmptyAndNeverThrows() throws Exception {
        assertEquals("", sanitize(null));
    }

    /* ---------- readLimited: bounded read, never unbounded memory ---------- */

    @Test public void readLimitedStopsAtTheLimit() throws Exception {
        File f = File.createTempFile("friday-diag", ".log");
        f.deleteOnExit();
        try (FileWriter w = new FileWriter(f, StandardCharsets.UTF_8)) {
            for (int i = 0; i < 500; i++) w.write("line " + i + "\n");
        }
        String out = (String) priv("readLimited", File.class, int.class).invoke(null, f, 200);
        assertTrue("limit not honoured: " + out.length(), out.length() < 5000);
        assertTrue(out.contains("line 0"));
    }

    @Test public void readLimitedReturnsEmptyForMissingFile() throws Exception {
        File missing = new File("/definitely/not/here/friday.log");
        String out = (String) priv("readLimited", File.class, int.class).invoke(null, missing, 100);
        assertEquals("", out);
    }

    @Test public void readLimitedNeverThrowsOnAnUnreadablePath() throws Exception {
        // a directory is not readable as a file — must swallow, not crash
        Object out = priv("readLimited", File.class, int.class).invoke(null, new File("/tmp"), 100);
        assertEquals("", out);
    }

    /* ---------- isoNow: the format other tooling parses ---------- */

    @Test public void isoNowMatchesTheExpectedUtcShape() throws Exception {
        String s = (String) priv("isoNow").invoke(null);
        assertTrue("bad shape: " + s, s.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"));
    }

    @Test public void isoNowIsUtcNotLocalTime() throws Exception {
        String s = (String) priv("isoNow").invoke(null);
        // must end in Z (UTC marker), never a local offset
        assertTrue("not UTC-marked: " + s, s.endsWith("Z"));
        assertNotEquals("", s);
    }
}
