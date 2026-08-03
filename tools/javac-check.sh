#!/usr/bin/env bash
# Compile-check all native sources against android.jar + capacitor stubs.
# Includes the vendored sherpa-onnx java-api (native/vendor/sherpa).
# Run tools/buildenv.sh once first (or again after /tmp was wiped).
set -e
[ -f /tmp/p34/android-34/android.jar ] || bash tools/buildenv.sh
rm -rf /tmp/jout && mkdir -p /tmp/jout
javac -encoding UTF-8 \
  -cp /tmp/p34/android-34/android.jar:/tmp/capstubs/out:/tmp/kotlin-stdlib.jar \
  -d /tmp/jout native/*.java native/vendor/sherpa/com/k2fsa/sherpa/onnx/*.java
echo "JAVAC OK"
