#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Registers FRIDAY's custom plugins with Capacitor's MainActivity. Run by Codemagic."""
import re, io, glob, sys

PLUGINS = ['FridayNative', 'FridaySpeech', 'FridayWakeWord', 'FridayVosk', 'LlamaCpp', 'FridaySensors', 'FridayHealthConnect']

cands = glob.glob('android/app/src/main/java/**/MainActivity.java', recursive=True)
if not cands:
    sys.exit('ERROR: MainActivity.java not found')

path = cands[0]
s = io.open(path, encoding='utf-8').read()

missing = [p for p in PLUGINS if (p + '.class') not in s]
if not missing:
    print('All plugins already registered in', path)
    sys.exit(0)

reg_lines = ''.join('        registerPlugin(%s.class);\n' % p for p in PLUGINS)

if 'import android.os.Bundle;' not in s:
    s = s.replace('import com.getcapacitor.BridgeActivity;',
                  'import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;')

# wipe any partial old registrations, then insert a single clean block
s = re.sub(r'\s*registerPlugin\((FridayNative|FridaySpeech|FridayWakeWord|FridayVosk|LlamaCpp|FridaySensors|FridayHealthConnect)\.class\);', '', s)

if 'onCreate' in s:
    s = re.sub(r'(public void onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{\s*)',
               r'\1\n' + reg_lines.replace('\n', ''), s, count=1)
else:
    s = s.replace(
        'public class MainActivity extends BridgeActivity {',
        'public class MainActivity extends BridgeActivity {\n'
        '    @Override\n'
        '    public void onCreate(Bundle savedInstanceState) {\n'
        + reg_lines +
        '        super.onCreate(savedInstanceState);\n'
        '    }\n')

# v9.0 APEX (A2): stash warm-start share intents so FridayNative.getSharedContent
# can hand them to the web layer (cold starts come in via the launch intent).
if 'onNewIntent' not in s:
    hook = ('\n    @Override\n'
            '    protected void onNewIntent(android.content.Intent intent) {\n'
            '        super.onNewIntent(intent);\n'
            '        try { FridayNative.pendingShare = intent; } catch (Throwable ignored) {}\n'
            '    }\n')
    s = s.rstrip()
    assert s.endswith('}'), 'MainActivity: unexpected file end'
    s = s[:s.rindex('}')] + hook + '}\n'
    print('Added onNewIntent share hook to MainActivity')

io.open(path, 'w', encoding='utf-8').write(s)
print('Registered: %s in %s' % (', '.join(PLUGINS), path))
