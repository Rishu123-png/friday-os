#!/usr/bin/env python3
"""Fail-fast checks for the generated Android project used by Codemagic."""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

APP_ID = "com.rishu.fridayos"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def fail(message: str) -> None:
    raise SystemExit("ANDROID VALIDATION FAILED: " + message)


def main() -> None:
    cfg = json.loads(Path("capacitor.config.json").read_text(encoding="utf-8"))
    if cfg.get("appId") != APP_ID or cfg.get("webDir") != "www":
        fail("Capacitor appId/webDir mismatch")

    gradle = Path("android/app/build.gradle").read_text(encoding="utf-8")
    if APP_ID not in gradle:
        fail("generated applicationId/namespace does not contain " + APP_ID)

    manifest_path = Path("android/app/src/main/AndroidManifest.xml")
    root = ET.parse(manifest_path).getroot()
    app = root.find("application")
    if app is None:
        fail("manifest has no application")

    required_permissions = {
        "android.permission.INTERNET", "android.permission.RECORD_AUDIO",
        "android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS",
        "android.permission.FOREGROUND_SERVICE", "android.permission.RECEIVE_BOOT_COMPLETED"
    }
    actual = {node.get(ANDROID + "name") for node in root.findall("uses-permission")}
    missing = sorted(required_permissions - actual)
    if missing:
        fail("missing permissions: " + ", ".join(missing))

    required_components = {
        "service": {".FridayService", ".FridayNotificationService", ".FridayAccessibility"},
        "receiver": {".FridayBootReceiver", ".FridayWidgetProvider"},
        "provider": {"androidx.core.content.FileProvider"},
    }
    for kind, wanted in required_components.items():
        found = {node.get(ANDROID + "name") for node in app.findall(kind)}
        absent = wanted - found
        if absent:
            fail(f"missing {kind}: " + ", ".join(sorted(absent)))

    main = Path(f"android/app/src/main/java/{APP_ID.replace('.', '/')}/MainActivity.java")
    if not main.is_file():
        fail("MainActivity is not in the app package")
    main_text = main.read_text(encoding="utf-8")
    plugins = ["FridayNative", "FridaySpeech", "FridayWakeWord", "FridayVosk",
               "FridayTranslate", "FridaySherpa", "LlamaCpp", "FridaySensors",
               "FridayHealthConnect"]
    missing_plugins = [p for p in plugins if f"registerPlugin({p}.class)" not in main_text]
    if missing_plugins:
        fail("unregistered plugins: " + ", ".join(missing_plugins))

    assets = Path("android/app/src/main/assets/public")
    for rel in ("index.html", "js/app.js", "js/boot-runtime.js"):
        if not (assets / rel).is_file():
            fail("Phase 3 asset missing after cap sync: " + rel)
    app_js = (assets / "js/app.js").read_text(encoding="utf-8")
    if "settleOptional" not in app_js or "friday:boot-timeout" not in app_js:
        fail("synced app.js is not the Phase 3 boot implementation")
    html = (assets / "index.html").read_text(encoding="utf-8")
    if re.search(r'id="(?:voskDownload|voiceDownload|earsDownload|embedDownload|modelList)"', html):
        fail("model download controls returned in production assets")
    if re.search(r"gsk_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9]{20,}", html + app_js):
        fail("possible API key in packaged web assets")

    print(f"Android validation OK: {APP_ID}; {len(actual)} permissions; Phase 3 assets synced")


if __name__ == "__main__":
    main()
