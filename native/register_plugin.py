#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Registers FridayNative with Capacitor's MainActivity. Run by Codemagic."""
import re, io, glob, sys

cands = glob.glob('android/app/src/main/java/**/MainActivity.java', recursive=True)
if not cands:
    sys.exit('ERROR: MainActivity.java not found')

path = cands[0]
s = io.open(path, encoding='utf-8').read()

if 'FridaySpeech.class' in s:
    print('Plugin already registered in', path)
    sys.exit(0)

if 'import android.os.Bundle;' not in s:
    s = s.replace('import com.getcapacitor.BridgeActivity;',
                  'import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;')

if 'onCreate' in s:
    s = re.sub(r'(public void onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{\s*)',
               r'\1        registerPlugin(FridayNative.class);\n        registerPlugin(FridaySpeech.class);\n        ',
               s, count=1)
else:
    s = s.replace(
        'public class MainActivity extends BridgeActivity {',
        'public class MainActivity extends BridgeActivity {\n'
        '    @Override\n'
        '    public void onCreate(Bundle savedInstanceState) {\n'
        '        registerPlugin(FridayNative.class);\n'
        '        registerPlugin(FridaySpeech.class);\n'
        '        super.onCreate(savedInstanceState);\n'
        '    }\n')

io.open(path, 'w', encoding='utf-8').write(s)
print('Registered FridayNative in', path)
print('---')
print(s)
