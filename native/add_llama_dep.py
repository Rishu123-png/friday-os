#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adds native dependencies to android/app/build.gradle. Run by Codemagic.

   Always on:
     - de.kherud:llama                    (offline LLM engine)
     - play-services-location             (native geofencing; already pulled
                                           transitively by @capacitor/geolocation,
                                           declared explicitly so it survives
                                           Capacitor upgrades)

   Optional (flip the flag, the Java side is reflection-based so a build
   WITHOUT the AAR still compiles and falls back to the software loop):
     - ai.picovoice:porcupine-android     (always-on "Jarvis"-style hotword;
                                           needs a free AccessKey FROM A
                                           COMPANY EMAIL at console.picovoice.ai)
     - com.alphacephei:vosk-android       (v9.1 WAKE FREE: keyless offline
                                           hotword, ANY custom word incl
                                           "friday" - no account, no email,
                                           ~36MB one-time model download)
"""
import io, os, re, sys

PATH = 'android/app/build.gradle'

# androidx.health.connect:connect-client declares minSdk 26 in its AAR manifest;
# the Capacitor template defaults to 22, which makes manifest merger fail.
# Raise the project's floor once, here. Health Connect needs Android 8+ anyway.
MIN_SDK_FLOOR = 26

LLAMA_VERSION = '4.1.0'        # bump if Maven Central 404s -- engine adapter is version-tolerant
LOCATION_VERSION = '21.3.0'    # from Google's maven (google() repo, already in the template)
# androidx Health Connect client (google() repo). PINNED to alpha08:
# the newest release whose AAR metadata accepts compileSdk 34 + AGP 8.2.x
# (alpha09+ needs SDK 35, rc/stable need SDK 36 + AGP 8.9.1 -- the Java side
#  talks to it purely by reflection, so the alpha works identically).
HEALTH_CONNECT_VERSION = '1.1.0-alpha08'

PORCUPINE_ENABLED = True      # <- set True + add your key in Settings to enable the hotword engine
PORCUPINE_VERSION = '4.0.2'

VOSK_ENABLED = True           # v9.1 WAKE FREE: keyless wake word (FridayVosk.java, reflection-based)
VOSK_VERSION = '0.3.47'

TRANSLATE_ENABLED = True      # v10.0 JARVIS: offline 50+ language translator (FridayTranslate.java, reflection-based)
TRANSLATE_VERSION = '17.0.3'   # latest published on dl.google.com (maven-metadata verified; 17.0.9 does NOT exist)
LANGUAGE_ID_VERSION = '17.0.6'

DEPS = [
    ('de.kherud:llama',
     'implementation "de.kherud:llama:%s"' % LLAMA_VERSION),
    ('com.google.android.gms:play-services-location',
     'implementation "com.google.android.gms:play-services-location:%s"' % LOCATION_VERSION),
]

if PORCUPINE_ENABLED:
    DEPS.append(('ai.picovoice:porcupine-android',
                 'implementation "ai.picovoice:porcupine-android:%s"' % PORCUPINE_VERSION))

if VOSK_ENABLED:
    DEPS.append(('com.alphacephei:vosk-android',
                 'implementation "com.alphacephei:vosk-android:%s"' % VOSK_VERSION))

if TRANSLATE_ENABLED:
    DEPS.append(('com.google.mlkit:translate',
                 'implementation "com.google.mlkit:translate:%s"' % TRANSLATE_VERSION))
    DEPS.append(('com.google.mlkit:language-id',
                 'implementation "com.google.mlkit:language-id:%s"' % LANGUAGE_ID_VERSION))

DEPS.append(('androidx.health.connect:connect-client',
             'implementation "androidx.health.connect:connect-client:%s"' % HEALTH_CONNECT_VERSION))


def raise_min_sdk():
    """Ensure the project's minSdkVersion >= MIN_SDK_FLOOR. Idempotent."""
    # 1) Capacitor template keeps it in android/variables.gradle
    #    (referenced from app/build.gradle as rootProject.ext.minSdkVersion)
    vpath = 'android/variables.gradle'
    if os.path.exists(vpath):
        s = io.open(vpath, encoding='utf-8').read()
        m = re.search(r'(?m)^(\s*)minSdkVersion\s*=\s*(\d+)', s)
        if m:
            cur = int(m.group(2))
            if cur < MIN_SDK_FLOOR:
                s = s[:m.start(2)] + str(MIN_SDK_FLOOR) + s[m.end(2):]
                io.open(vpath, 'w', encoding='utf-8').write(s)
                print('Raised minSdkVersion %d -> %d in %s' % (cur, MIN_SDK_FLOOR, vpath))
            else:
                print('minSdkVersion already %d (>= %d) in %s' % (cur, MIN_SDK_FLOOR, vpath))
            return
    # 2) fallback: literal "minSdkVersion 22" inside app/build.gradle
    try:
        s = io.open(PATH, encoding='utf-8').read()
    except FileNotFoundError:
        return
    m = re.search(r'(minSdkVersion\s+)(\d+)', s)
    if m and int(m.group(2)) < MIN_SDK_FLOOR:
        s = s[:m.start(2)] + str(MIN_SDK_FLOOR) + s[m.end(2):]
        io.open(PATH, 'w', encoding='utf-8').write(s)
        print('Raised minSdkVersion %s -> %d in %s' % (m.group(2), MIN_SDK_FLOOR, PATH))
    elif not m:
        print('NOTE: no literal minSdkVersion in build.gradle (uses rootProject.ext); checked variables.gradle too -- nothing to raise')


def main():
    try:
        s = io.open(PATH, encoding='utf-8').read()
    except FileNotFoundError:
        print('WARN: %s not found -- run "npx cap add android" first' % PATH)
        return
    if 'dependencies {' not in s:
        sys.exit('ERROR: dependencies block not found in build.gradle')

    added, present = [], []
    for marker, dep in DEPS:
        if marker in s:
            present.append(marker)
        else:
            s = s.replace('dependencies {', 'dependencies {\n    %s' % dep, 1)
            added.append(dep)

    io.open(PATH, 'w', encoding='utf-8').write(s)
    for d in added:
        print('Added:', d)
    if present:
        print('Already present:', ', '.join(present))
    raise_min_sdk()
    if not PORCUPINE_ENABLED:
        print('Porcupine hotword engine: OFF (flip PORCUPINE_ENABLED to include the AAR)')


if __name__ == '__main__':
    main()
