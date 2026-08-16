package com.rishu.fridayos;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/** Focused local-JVM tests for resumable download and safe extraction policies. */
public class FridayDownloadWorkerTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void contentRangeMustResumeAtExactByteAndMatchKnownTotal() {
        assertTrue(FridayDownloadWorker.validContentRange("bytes 4096-8191/16384", 4096, 16384));
        assertTrue(FridayDownloadWorker.validContentRange("bytes 4096-8191/16384", 4096, 0));
        assertFalse(FridayDownloadWorker.validContentRange("bytes 0-8191/16384", 4096, 16384));
        assertFalse(FridayDownloadWorker.validContentRange("bytes 4096-8191/20000", 4096, 16384));
        assertFalse(FridayDownloadWorker.validContentRange("bytes 4096-16384/16384", 4096, 16384));
        assertFalse(FridayDownloadWorker.validContentRange("bytes */16384", 4096, 16384));
        assertFalse(FridayDownloadWorker.validContentRange(null, 4096, 16384));
    }

    @Test
    public void destinationPolicyRejectsTraversalAndAbsolutePaths() {
        assertTrue(FridayDownloads.safeRelative("vosk/wake-model.zip"));
        assertTrue(FridayDownloads.safeRelative("models/local.gguf"));
        assertFalse(FridayDownloads.safeRelative("../outside.gguf"));
        assertFalse(FridayDownloads.safeRelative("vosk/../../outside"));
        assertFalse(FridayDownloads.safeRelative("/absolute/path"));
        assertFalse(FridayDownloads.safeRelative("vosk//model.zip"));
        assertFalse(FridayDownloads.safeRelative("vosk/model name.zip"));
    }

    @Test
    public void extractorStripsExactlyOneTopLevelDirectory() throws Exception {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("vosk-model/conf/model.conf", "config".getBytes(StandardCharsets.UTF_8));
        entries.put("vosk-model/am/model.bin", new byte[] { 1, 2, 3, 4 });
        File zip = makeZip(entries);
        File destination = new File(temp.getRoot(), "staging");

        FridayDownloadWorker.extractZip(zip, destination, true, 1024);

        assertArrayEquals("config".getBytes(StandardCharsets.UTF_8),
                Files.readAllBytes(new File(destination, "conf/model.conf").toPath()));
        assertArrayEquals(new byte[] { 1, 2, 3, 4 },
                Files.readAllBytes(new File(destination, "am/model.bin").toPath()));
        assertFalse(new File(destination, "vosk-model").exists());
    }

    @Test
    public void extractorRejectsTraversalWithoutWritingOutsideStaging() throws Exception {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("../escaped.txt", "escape".getBytes(StandardCharsets.UTF_8));
        File zip = makeZip(entries);
        File destination = new File(temp.getRoot(), "staging-traversal");
        File escaped = new File(temp.getRoot(), "escaped.txt");

        expectExtractFailure(zip, destination, false, 1024, "unsafe_zip_entry");

        assertFalse(destination.exists());
        assertFalse(escaped.exists());
    }

    @Test
    public void extractorRejectsCanonicalDuplicateAndCleansPartialOutput() throws Exception {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("folder/../model.bin", new byte[] { 1 });
        entries.put("model.bin", new byte[] { 2 });
        File zip = makeZip(entries);
        File destination = new File(temp.getRoot(), "staging-duplicate");

        expectExtractFailure(zip, destination, false, 1024, "unsafe_zip_entry");

        assertFalse(destination.exists());
    }

    @Test
    public void extractorRejectsMultipleRootsAndExpansionLimit() throws Exception {
        Map<String, byte[]> multipleRoots = new LinkedHashMap<>();
        multipleRoots.put("root-a/model.bin", new byte[] { 1 });
        multipleRoots.put("root-b/model.bin", new byte[] { 2 });
        File multiZip = makeZip(multipleRoots);
        File multiDestination = new File(temp.getRoot(), "staging-multiple");
        expectExtractFailure(multiZip, multiDestination, true, 1024,
                "zip_multiple_top_level_entries");
        assertFalse(multiDestination.exists());

        Map<String, byte[]> expanded = new LinkedHashMap<>();
        expanded.put("model.bin", new byte[] { 1, 2, 3, 4, 5 });
        File expandedZip = makeZip(expanded);
        File expandedDestination = new File(temp.getRoot(), "staging-expanded");
        expectExtractFailure(expandedZip, expandedDestination, false, 4,
                "zip_expansion_limit");
        assertFalse(expandedDestination.exists());
    }

    private File makeZip(Map<String, byte[]> entries) throws Exception {
        File zip = temp.newFile("archive-" + System.nanoTime() + ".zip");
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(zip))) {
            for (Map.Entry<String, byte[]> item : entries.entrySet()) {
                out.putNextEntry(new ZipEntry(item.getKey()));
                out.write(item.getValue());
                out.closeEntry();
            }
        }
        return zip;
    }

    private static void expectExtractFailure(File zip, File destination,
                                             boolean stripTopLevel, long maxExpanded,
                                             String expectedMessage) throws Exception {
        try {
            FridayDownloadWorker.extractZip(zip, destination, stripTopLevel, maxExpanded);
            fail("Expected extraction to reject " + expectedMessage);
        } catch (Exception error) {
            assertTrue("Unexpected error: " + error,
                    String.valueOf(error.getMessage()).contains(expectedMessage));
        }
    }
}
