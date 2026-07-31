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
                                           get a free AccessKey at
                                           console.picovoice.ai)
"""
import io, sys

PATH = 'android/app/build.gradle'

LLAMA_VERSION = '4.1.0'        # bump if Maven Central 404s -- engine adapter is version-tolerant
LOCATION_VERSION = '21.3.0'    # from Google's maven (google() repo, already in the template)
HEALTH_CONNECT_VERSION = '1.1.0'  # androidx Health Connect client (google() repo)

PORCUPINE_ENABLED = True      # <- set True + add your key in Settings to enable the hotword engine
PORCUPINE_VERSION = '4.0.2'

DEPS = [
    ('de.kherud:llama',
     'implementation "de.kherud:llama:%s"' % LLAMA_VERSION),
    ('com.google.android.gms:play-services-location',
     'implementation "com.google.android.gms:play-services-location:%s"' % LOCATION_VERSION),
]

if PORCUPINE_ENABLED:
    DEPS.append(('ai.picovoice:porcupine-android',
                 'implementation "ai.picovoice:porcupine-android:%s"' % PORCUPINE_VERSION))

DEPS.append(('androidx.health.connect:connect-client',
             'implementation "androidx.health.connect:connect-client:%s"' % HEALTH_CONNECT_VERSION))


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
    if not PORCUPINE_ENABLED:
        print('Porcupine hotword engine: OFF (flip PORCUPINE_ENABLED to include the AAR)')


if __name__ == '__main__':
    main()
