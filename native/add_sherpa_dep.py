#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v10.0 JARVIS: fetches the sherpa-onnx NATIVE libraries (.so) into the Android
   project so the vendored java-api (native/vendor/sherpa) + FridaySherpa.java
   have their JNI backend. Run by Codemagic BEFORE gradle assembles.

   - Downloads k2-fsa/sherpa-onnx release sherpa-onnx-<VER>-android.tar.bz2
   - Extracts ONLY the AAR pieces we need (jniLibs/<abi>/*.so) into
     android/app/src/main/jniLibs/ (AGP packages that dir automatically)
   - Idempotent: skips when libs already in place
   - arm64-v8a + armeabi-v7a are kept (phones); x86/x86_64 skipped (emulator
     size). Flip KEEP_X86 if you debug in an emulator.

   Java side is reflection-safe: if these libs are missing, FridaySherpa answers
   engine_missing and voice falls back to the Android TTS. Nothing crashes. """

import io, os, subprocess, sys, tarfile, urllib.request

VERSION = '1.12.17'
URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v%s/sherpa-onnx-v%s-android.tar.bz2' % (VERSION, VERSION)
DEST = 'android/app/src/main/jniLibs'
MARK = os.path.join(DEST, 'arm64-v8a', 'libsherpa-onnx-jni.so')
KEEP_X86 = False


def done(msg):
    print('[sherpa] %s' % msg)


def main():
    if os.path.exists(MARK):
        done('natives already present - nothing to do')
        return
    if not os.path.isdir('android/app'):
        done('android project not generated yet - run `npx cap add android` first; skipping')
        return

    tmp = 'sherpa-natives.tar.bz2'
    done('downloading sherpa-onnx v%s android natives (one time, ~36MB)...' % VERSION)
    urllib.request.urlretrieve(URL, tmp)
    done('extracting .so files into %s' % DEST)
    with tarfile.open(tmp, 'r:bz2') as tf:
        for member in tf.getmembers():
            name = member.name
            if not name.startswith('./jniLibs/'):
                continue
            if not name.endswith('.so'):
                continue
            if not KEEP_X86 and ('/x86/' in name or '/x86_64/' in name):
                continue
            rel = name[len('./jniLibs/'):]
            target = os.path.join(DEST, rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with tf.extractfile(member) as src, open(target, 'wb') as out:
                out.write(src.read())
            done('  + %s' % rel)
    os.remove(tmp)
    if os.path.exists(MARK):
        done('OK - neural voice + offline ears natives installed')
    else:
        print('[sherpa] ERROR: marker missing after extract', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
