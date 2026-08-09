#!/usr/bin/env python3
"""Configure the generated Capacitor Gradle project for Codemagic signing.

Uses only Codemagic-provided environment variables. No credential is written to
source control. This script is intentionally limited to release signing.
"""
import os
import re
import sys
from pathlib import Path

PATH = Path("android/app/build.gradle")
REQUIRED = ("CM_KEYSTORE_PATH", "CM_KEYSTORE_PASSWORD", "CM_KEY_ALIAS", "CM_KEY_PASSWORD")


def main() -> None:
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        sys.exit("Missing Codemagic signing environment: " + ", ".join(missing))
    if not Path(os.environ["CM_KEYSTORE_PATH"]).is_file():
        sys.exit("CM_KEYSTORE_PATH does not point to a file")
    if not PATH.is_file():
        sys.exit("Generate Android first: npx cap add android")

    text = PATH.read_text(encoding="utf-8")
    if "fridayCodemagicRelease" not in text:
        signing = r'''
    // fridayCodemagicRelease: credentials are injected by Codemagic at build time.
    signingConfigs {
        fridayCodemagicRelease {
            storeFile file(System.getenv("CM_KEYSTORE_PATH"))
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }
    }
'''
        text = text.replace("android {", "android {" + signing, 1)

    release = re.compile(r"(buildTypes\s*\{\s*release\s*\{)", re.S)
    if not release.search(text):
        sys.exit("Could not locate generated buildTypes.release block")
    if "signingConfig signingConfigs.fridayCodemagicRelease" not in text:
        text = release.sub(r"\1\n            signingConfig signingConfigs.fridayCodemagicRelease", text, count=1)

    PATH.write_text(text, encoding="utf-8")
    print("Release signing configured from Codemagic environment")


if __name__ == "__main__":
    main()
