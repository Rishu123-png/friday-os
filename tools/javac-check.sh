#!/usr/bin/env bash
# Compile-check all native sources against android.jar + Capacitor stubs,
# including the vendored sherpa-onnx java-api (native/vendor/sherpa) and the
# JUnit suites in native/tests.
#
# Previously this script compiled only native/*.java, so a test file could rot
# silently — it would fail only in the Codemagic build, minutes later. It now
# compiles the tests too, and runs them when a JUnit jar can be found.
#
# Run tools/buildenv.sh once first (or again after /tmp was wiped).
#
#   bash tools/javac-check.sh          # compile everything, then run tests
#   NO_TESTS=1 bash tools/javac-check.sh   # compile only
set -e

[ -f /tmp/p34/android-34/android.jar ] || bash tools/buildenv.sh

# ---- locate a JUnit 4 jar ------------------------------------------------
JUNIT=""
for c in \
  "${JUNIT_JAR:-}" \
  /tmp/libs/junit4.jar \
  "$HOME"/.gradle/caches/modules-2/files-2.1/junit/junit/*/*/junit-*.jar \
  /usr/share/java/junit4.jar
do
  [ -n "$c" ] && ls $c >/dev/null 2>&1 && JUNIT="$(ls $c 2>/dev/null | head -1)" && break
done

HAMCREST=""
for c in \
  "${HAMCREST_JAR:-}" \
  /tmp/libs/hamcrest.jar \
  "$HOME"/.gradle/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core/*/*/hamcrest-core-*.jar \
  /usr/share/java/hamcrest-core.jar
do
  [ -n "$c" ] && ls $c >/dev/null 2>&1 && HAMCREST="$(ls $c 2>/dev/null | head -1)" && break
done

if [ -z "$JUNIT" ]; then
  echo "note: no JUnit 4 jar found — tests will be compiled if possible, not run."
  echo "      fetch one with:"
  echo "        mkdir -p /tmp/libs && cd /tmp/libs"
  echo "        curl -sLO https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar"
  echo "        curl -sLO https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar"
  echo "        mv junit-4.13.2.jar junit4.jar && mv hamcrest-core-1.3.jar hamcrest.jar"
fi

CP="/tmp/p34/android-34/android.jar:/tmp/capstubs/out:/tmp/kotlin-stdlib.jar"
[ -n "$JUNIT" ]    && CP="$CP:$JUNIT"
[ -n "$HAMCREST" ] && CP="$CP:$HAMCREST"

# ---- compile app + tests -------------------------------------------------
rm -rf /tmp/jout && mkdir -p /tmp/jout
javac -encoding UTF-8 -cp "$CP" -d /tmp/jout \
  native/*.java \
  native/vendor/sherpa/com/k2fsa/sherpa/onnx/*.java \
  native/tests/*.java
echo "JAVAC OK ($(ls native/*.java | wc -l | tr -d ' ') classes, $(ls native/tests/*.java | wc -l | tr -d ' ') test suites)"

# ---- run the suites ------------------------------------------------------
if [ -z "$JUNIT" ]; then
  echo "SKIPPED: native unit tests (no JUnit jar)"
  exit 0
fi

if [ "${NO_TESTS:-0}" = "1" ]; then
  echo "SKIPPED: native unit tests (NO_TESTS=1)"
  exit 0
fi

CLASSES=$(cd native/tests && ls ./*.java | sed 's|^\./||; s|\.java$||' | sed 's|^|com.rishu.fridayos.|' | tr '\n' ' ')
echo "running: $CLASSES"
java -cp "/tmp/jout:$CP" org.junit.runner.JUnitCore $CLASSES
