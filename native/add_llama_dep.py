#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adds the llama.cpp Java binding to android/app/build.gradle. Run by Codemagic."""
import io, sys

PATH = 'android/app/build.gradle'
LLAMA_VERSION = '4.1.0'   # bump if Maven Central 404s — engine adapter is version-tolerant
DEP = 'implementation "de.kherud:llama:%s"' % LLAMA_VERSION

def main():
    try:
        s = io.open(PATH, encoding='utf-8').read()
    except FileNotFoundError:
        print('WARN: %s not found — run "npx cap add android" first' % PATH)
        return
    if 'de.kherud:llama' in s:
        print('llama dependency already present')
        return
    if 'dependencies {' not in s:
        sys.exit('ERROR: dependencies block not found in build.gradle')
    s = s.replace('dependencies {', 'dependencies {\n    %s' % DEP, 1)
    io.open(PATH, 'w', encoding='utf-8').write(s)
    print('Added:', DEP)

if __name__ == '__main__':
    main()
