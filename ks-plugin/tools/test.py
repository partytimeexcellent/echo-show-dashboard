#!/usr/bin/env python3
"""Run the plugin's tests against the SDK on a desktop JVM (no device or Android SDK needed)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
java_home = os.environ.get('JAVA_HOME')
def tool(name):
    return str(Path(java_home) / 'bin' / name) if java_home else name

manifest = json.loads((root / 'kiosk-satellite-plugin.json').read_text())
keys = [s['key'] for s in manifest['settings']]
assert len(keys) == len(set(keys)) <= 20, 'settings'
for s in manifest['settings']:
    if s['type'] == 'select':
        assert s['default'] in s['options'], s['key']
    if s['type'] == 'number':
        assert s['min'] <= s['default'] <= s['max'], s['key']
assert set(manifest['capabilities']) <= {'overlay', 'native', 'entities', 'host.read', 'host.control', 'shizuku', 'screensaver'}
assert len(manifest['description']) <= 1000

sources = [*sorted((root / 'sdk/src').rglob('*.java')), *sorted((root / 'src').rglob('*.java')), *sorted((root / 'tests').rglob('*.java'))]
with tempfile.TemporaryDirectory(prefix='kiosk-plugin-test-') as directory:
    subprocess.run([tool('javac'), '--release', '8', '-Xlint:-options', '-d', directory, *map(str, sources)], check=True)
    subprocess.run([tool('java'), '-ea', '-cp', directory, 'io.github.partytimeexcellent.echoshow.VolumeButtonsTest'], check=True)
