#!/usr/bin/env bash
# Compile-check all native sources against android.jar + capacitor stubs.
# Run tools/buildenv.sh once first (or again after /tmp was wiped).
set -e
[ -f /tmp/p34/android-34/android.jar ] || bash tools/buildenv.sh
rm -rf /tmp/jout && mkdir -p /tmp/jout
javac -cp /tmp/p34/android-34/android.jar:/tmp/capstubs/out:/tmp/kotlin-stdlib.jar -d /tmp/jout native/*.java
echo "JAVAC OK"
