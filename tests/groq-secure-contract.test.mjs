import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Android secret store is allowlisted, private and Keystore encrypted', async () => {
  const java = await read('native/FridayNative.java');
  assert.match(java, /"groq_primary"\.equals\(name\)\s*\|\|\s*"groq_standby"\.equals\(name\)/);
  assert.match(java, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
  assert.match(java, /Cipher\.getInstance\("AES\/GCM\/NoPadding"\)/);
  assert.equal((java.match(/updateAAD\(name\.getBytes\(StandardCharsets\.UTF_8\)\)/g) || []).length, 2);
  assert.match(java, /getSharedPreferences\(SECRET_PREFS, Context\.MODE_PRIVATE\)/);
  assert.match(java, /putString\(name \+ "\.iv"/);
  assert.match(java, /putString\(name \+ "\.ct"/);
  assert.doesNotMatch(java, /putString\(name\s*,\s*value\)/);
});

test('Codemagic-generated Android app excludes secure preferences from backup and transfer', async () => {
  const [patch, legacy, extraction, codemagic] = await Promise.all([
    read('native/patch_manifest.py'),
    read('native/res/xml/friday_backup_rules.xml'),
    read('native/res/xml/friday_data_extraction_rules.xml'),
    read('codemagic.yaml')
  ]);
  assert.match(patch, /android:fullBackupContent[^\n]+@xml\/friday_backup_rules/);
  assert.match(patch, /android:dataExtractionRules[^\n]+@xml\/friday_data_extraction_rules/);
  assert.match(legacy, /exclude domain="sharedpref" path="friday_secure_secrets\.xml"/);
  assert.equal((extraction.match(/exclude domain="sharedpref" path="friday_secure_secrets\.xml"/g) || []).length, 2);
  assert.equal((codemagic.match(/cp native\/res\/xml\/\*\.xml android\/app\/src\/main\/res\/xml\//g) || []).length, 2);
});

test('Settings has two masked runtime fields and never prefills a credential', async () => {
  const html = await read('www/index.html');
  for (const id of ['groqPrimaryKey', 'groqStandbyKey']) {
    assert.match(html, new RegExp(`<input[^>]+type="password"[^>]+id="${id}"`));
  }
  assert.match(html, /id="saveGroqKeys"/);
  assert.match(html, /id="clearGroqKeys"/);
  assert.match(html, /id="groqKeysStatus"[^>]+aria-live="polite"/);
  assert.doesNotMatch(html, /id="groq(?:Primary|Standby)Key"[^>]+value=/);
});

test('ordinary settings store keeps only non-secret Groq booleans', async () => {
  const store = await read('www/js/store.js');
  assert.match(store, /groqPrimaryConfigured:\s*false/);
  assert.match(store, /groqStandbyConfigured:\s*false/);
  assert.match(store, /delete _settings\.groqKey/);
  assert.doesNotMatch(store, /^\s*groqKey:\s*['"]/m);
});

test('web bridge deliberately has no cleartext fallback for secure slots', async () => {
  const native = await read('www/js/native.js');
  const block = native.slice(
    native.indexOf('/* ================= ENCRYPTED APP SECRETS'),
    native.indexOf('/* ================= CONTACTS')
  );
  assert.match(block, /secure_store_timeout/);
  assert.match(block, /secureCall\('setSecureSecret'/);
  assert.match(block, /secureCall\('getSecureSecret'/);
  assert.match(block, /secureCall\('deleteSecureSecret'/);
  assert.doesNotMatch(block, /localStorage|sessionStorage|Preferences/);
});
