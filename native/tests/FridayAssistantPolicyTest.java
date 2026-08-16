package com.rishu.fridayos;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class FridayAssistantPolicyTest {
    @Test public void classifiesImportantCategories() {
        assertEquals(FridayAssistantPolicy.Category.MESSAGE,
                FridayAssistantPolicy.classify("com.whatsapp", "Ria", "hello"));
        assertEquals(FridayAssistantPolicy.Category.DELIVERY,
                FridayAssistantPolicy.classify("com.amazon.shopping", "Order", "Out for delivery"));
        assertEquals(FridayAssistantPolicy.Category.SENSITIVE,
                FridayAssistantPolicy.classify("com.bank", "OTP", "OTP 123456 for transaction"));
    }

    @Test public void overnightQuietHoursAreCorrect() {
        assertTrue(FridayAssistantPolicy.isQuietMinute(23 * 60, 22 * 60, 7 * 60));
        assertTrue(FridayAssistantPolicy.isQuietMinute(6 * 60, 22 * 60, 7 * 60));
        assertFalse(FridayAssistantPolicy.isQuietMinute(12 * 60, 22 * 60, 7 * 60));
    }

    @Test public void sensitivePromptNeverContainsSensitiveBodyOrPromisesDisclosure() {
        String prompt = FridayAssistantPolicy.prompt("Sir", FridayAssistantPolicy.Category.SENSITIVE,
                "Bank", "OTP 123456", true);
        assertTrue(prompt.startsWith("Sir, a private notification"));
        assertTrue(prompt.contains("review it securely"));
        assertFalse(prompt.contains("123456"));
        assertFalse(prompt.contains("headphones"));
    }

    @Test public void lockedPromptOmitsApplicationAndSenderIdentity() {
        String prompt = FridayAssistantPolicy.prompt("Boss", FridayAssistantPolicy.Category.MESSAGE,
                "WhatsApp", "Ria", false);
        assertTrue(prompt.startsWith("Boss, a private notification"));
        assertFalse(prompt.contains("WhatsApp"));
        assertFalse(prompt.contains("Ria"));
    }

    @Test public void trustedBoundedTextPreservesReminderNumbers() {
        assertEquals("Pay invoice 123456 at 20:30",
                FridayAssistantPolicy.boundedText("Pay invoice 123456 at 20:30", 100));
        assertFalse(FridayAssistantPolicy.safeText("OTP 123456", 100).contains("123456"));
    }

    @Test public void importanceFiltersSystemAndOtherNoise() {
        assertTrue(FridayAssistantPolicy.isWorthInterrupting(FridayAssistantPolicy.Category.MESSAGE, 3));
        assertFalse(FridayAssistantPolicy.isWorthInterrupting(FridayAssistantPolicy.Category.SYSTEM, 5));
        assertFalse(FridayAssistantPolicy.isWorthInterrupting(FridayAssistantPolicy.Category.MESSAGE, 1));
    }
}
