import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'protocol/action-v1.schema.json');

test('protocol schema is in sync with backend ACTION_DEFINITIONS', async () => {
  const before = await readFile(schemaPath, 'utf8');
  // regenerate
  execSync('python3 tools/generate_action_schema.py', { cwd: root, stdio: 'pipe' });
  const after = await readFile(schemaPath, 'utf8');
  assert.equal(before, after, 'protocol/action-v1.schema.json is out of sync - run python3 tools/generate_action_schema.py');
});
