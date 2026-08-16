import { test } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); }
};

const plugins = {};
global.window = {
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: plugins
  }
};

const NAT = await import('../www/js/native.js');

function installDownloadPlugin({ enqueue, statuses, cancel } = {}) {
  let statusIndex = 0;
  const seen = { enqueue: [], status: [], cancel: [] };
  plugins.FridayDownloads = {
    async enqueue(args) {
      seen.enqueue.push(args);
      return enqueue || { ok: true, jobId: 'job-persistent-1', state: 'enqueued' };
    },
    async status(args) {
      seen.status.push(args);
      const values = statuses || [{
        ok: true, jobId: args.jobId, state: 'succeeded', percent: 100,
        bytes: 36_000_000, totalBytes: 36_000_000,
        path: '/data/user/0/com.rishu.fridayos/files/vosk/wake-model.zip_extracted'
      }];
      return values[Math.min(statusIndex++, values.length - 1)];
    },
    async cancel(args) {
      seen.cancel.push(args);
      return cancel || { ok: true, jobId: args.jobId };
    },
    async jobs() { return { ok: true, jobs: [] }; }
  };
  return seen;
}

test('persistent downloader polls the WorkManager job and reports terminal path', async () => {
  const seen = installDownloadPlugin();
  const progress = [];
  const result = await NAT.downloadFilePersistent({
    url: 'https://downloads.example.test/model.gguf',
    dest: 'models/local.gguf',
    expectedBytes: 36_000_000,
    sha256: 'a'.repeat(64)
  }, (percent, bytes, total) => progress.push({ percent, bytes, total }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'succeeded');
  assert.equal(seen.enqueue.length, 1);
  assert.deepEqual(seen.enqueue[0], {
    url: 'https://downloads.example.test/model.gguf',
    dest: 'models/local.gguf',
    expectedBytes: 36_000_000,
    sha256: 'a'.repeat(64),
    extractZip: false,
    stripTopLevel: false
  });
  assert.deepEqual(seen.status, [{ jobId: 'job-persistent-1' }]);
  assert.deepEqual(progress, [{ percent: 100, bytes: 36_000_000, total: 36_000_000 }]);
});

test('Vosk download uses persistent staged extraction and accepts only a scanned model', async () => {
  const modelPath = '/data/user/0/com.rishu.fridayos/files/vosk/wake-model.zip_extracted';
  const seen = installDownloadPlugin({ statuses: [{
    ok: true, jobId: 'vosk-job-1', state: 'succeeded', percent: 100,
    bytes: 36_000_000, totalBytes: 36_000_000, path: modelPath
  }] });
  let scans = 0;
  plugins.FridayVosk = {
    async scanModels() {
      scans += 1;
      return { ok: true, items: [{ name: 'wake-model', path: `${modelPath}/`, mb: 36 }] };
    }
  };

  const result = await NAT.voskDownload();
  assert.equal(result.ok, true);
  assert.equal(result.path, `${modelPath}/`);
  assert.equal(result.mb, 36);
  assert.equal(scans, 1);
  assert.equal(seen.enqueue[0].url, 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip');
  assert.equal(seen.enqueue[0].dest, 'vosk/wake-model.zip');
  assert.equal(seen.enqueue[0].extractZip, true);
  assert.equal(seen.enqueue[0].stripTopLevel, true);
});

test('Vosk never persists an extracted directory that fails model scanning', async () => {
  const modelPath = '/data/user/0/com.rishu.fridayos/files/vosk/wake-model.zip_extracted';
  installDownloadPlugin({ statuses: [{
    ok: true, jobId: 'vosk-job-bad', state: 'succeeded', percent: 100, path: modelPath
  }] });
  plugins.FridayVosk = {
    async scanModels() { return { ok: true, items: [{ path: '/different/model', mb: 1 }] }; }
  };

  const result = await NAT.voskDownload('https://downloads.example.test/wake.zip');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_model');
  assert.equal(result.path, '');
});

test('failed enqueue is returned without polling, and cancellation uses the stable job id', async () => {
  const seen = installDownloadPlugin({ enqueue: { ok: false, reason: 'invalid_destination' } });
  const failed = await NAT.downloadFilePersistent({
    url: 'https://downloads.example.test/model.gguf', dest: '../outside.gguf'
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'invalid_destination');
  assert.equal(seen.status.length, 0);

  const cancelled = await NAT.cancelDownload('stable-job-id');
  assert.equal(cancelled.ok, true);
  assert.deepEqual(seen.cancel, [{ jobId: 'stable-job-id' }]);
});
