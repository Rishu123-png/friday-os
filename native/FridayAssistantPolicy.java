package com.rishu.fridayos;

import java.util.Locale;

/** Pure classification/privacy policy shared by the native assistant runtime. */
public final class FridayAssistantPolicy {
    public enum Category { MESSAGE, EMAIL, CALENDAR, DELIVERY, MISSED_CALL, SENSITIVE, SYSTEM, OTHER }

    private FridayAssistantPolicy() {}

    public static Category classify(String pkg, String title, String text) {
        String p = lower(pkg);
        String all = lower(title) + " " + lower(text);
        if (containsAny(all, "otp", "one time password", "verification code", "security code",
                "bank", "debited", "credited", "upi", "transaction", "card ending", "payment")) {
            return Category.SENSITIVE;
        }
        if (containsAny(all, "missed call", "call back") || p.contains("dialer") || p.contains("telecom")) {
            return Category.MISSED_CALL;
        }
        if (p.contains("calendar") || containsAny(all, "meeting", "appointment", "event starts", "calendar")) {
            return Category.CALENDAR;
        }
        if (containsAny(p, "whatsapp", "telegram", "signal", "messaging", "messages", "messenger", "discord", "slack")
                || containsAny(all, "new message", "sent you", "replied")) {
            return Category.MESSAGE;
        }
        if (containsAny(p, "gmail", "email", "outlook", "protonmail") || containsAny(all, "new email", "new mail")) {
            return Category.EMAIL;
        }
        if (containsAny(all, "delivery", "delivered", "out for delivery", "shipped", "arriving", "courier", "order #")
                || containsAny(p, "amazon", "flipkart", "swiggy", "zomato", "blinkit")) {
            return Category.DELIVERY;
        }
        if (p.startsWith("android") || p.contains("systemui")
                || containsAny(all, "battery", "storage", "update available", "permission")) {
            return Category.SYSTEM;
        }
        return Category.OTHER;
    }

    public static boolean isSensitive(String pkg, String title, String text) {
        return classify(pkg, title, text) == Category.SENSITIVE
                || containsAny(lower(pkg), "authenticator", "bank", "wallet", "payments");
    }

    public static boolean isWorthInterrupting(Category category, int importance) {
        if (importance <= 1) return false;
        return category != Category.OTHER && category != Category.SYSTEM;
    }

    public static boolean isQuietMinute(int minuteOfDay, int startMinute, int endMinute) {
        if (startMinute < 0 || endMinute < 0 || startMinute == endMinute) return false;
        int now = ((minuteOfDay % 1440) + 1440) % 1440;
        int start = ((startMinute % 1440) + 1440) % 1440;
        int end = ((endMinute % 1440) + 1440) % 1440;
        return start < end ? now >= start && now < end : now >= start || now < end;
    }

    public static String prompt(String address, Category category, String app, String title, boolean canReveal) {
        String who = clean(address).isEmpty() ? "Boss" : clean(address);
        String source = clean(app).isEmpty() ? "your phone" : clean(app);
        String sender = clean(title);
        if (category == Category.SENSITIVE) {
            return who + ", a private notification arrived. Open it on your phone to review it securely.";
        }
        if (!canReveal) {
            return who + ", a private notification arrived. Unlock your phone or use headphones to hear the details.";
        }
        switch (category) {
            case MESSAGE:
                return who + ", " + source + " message" + from(sender)
                        + ". Would you like me to read it, help draft a reply, or leave it for later?";
            case EMAIL:
                return who + ", new email" + from(sender)
                        + ". I can read it or leave it for later.";
            case CALENDAR:
                return who + ", calendar update" + from(sender)
                        + ". I can read the details or open it.";
            case DELIVERY:
                return who + ", delivery update from " + source
                        + ". I can read the details or open it.";
            case MISSED_CALL:
                return who + ", missed call" + from(sender) + ". I can open the caller or help message back.";
            default:
                return who + ", an important notification arrived from " + source + ".";
        }
    }

    /** Normalize trusted user-authored local data without changing its meaning. */
    public static String boundedText(String value, int max) {
        String normalized = clean(value);
        if (max > 0 && normalized.length() > max) {
            if (max == 1) return "…";
            return normalized.substring(0, max - 1).trim() + "…";
        }
        return normalized;
    }

    /** Speech/log-safe form for untrusted notification content. */
    public static String safeText(String value, int max) {
        String redacted = clean(value).replaceAll("https?://\\S+", "link")
                .replaceAll("\\b\\d{4,8}\\b", "private number");
        return boundedText(redacted, max);
    }

    public static String dedupeKey(String pkg, String title, String text) {
        return lower(pkg) + "|" + lower(title) + "|" + safeText(lower(text), 120);
    }

    private static String from(String sender) {
        return sender.isEmpty() ? "" : " from " + safeText(sender, 60);
    }

    private static boolean containsAny(String value, String... terms) {
        for (String term : terms) if (value.contains(term)) return true;
        return false;
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("[\\p{Cntrl}\\r\\n]+", " ").replaceAll("\\s+", " ").trim();
    }
}
