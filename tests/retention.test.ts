import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryR2Storage } from '../src/r2/memory.js';
import { cleanFeedHistoricArtifacts } from '../src/publisher/retention.js';

test('cleanFeedHistoricArtifacts retains active artifact plus previous LKG, deleting older', async () => {
  const storage = new MemoryR2Storage();
  const feedId = 'szeged';

  // 1. Insert oldest artifacts first
  await storage.putObject(`v1/feeds/${feedId}/artifacts/old2-sha.zip`, Buffer.from('old2'));
  await new Promise((r) => setTimeout(r, 10));

  await storage.putObject(`v1/feeds/${feedId}/artifacts/old1-sha.zip`, Buffer.from('old1'));
  await new Promise((r) => setTimeout(r, 10));

  // 2. Insert previous LKG artifact (more recent than old1/old2)
  await storage.putObject(`v1/feeds/${feedId}/artifacts/prev-sha.zip`, Buffer.from('prev'));
  await new Promise((r) => setTimeout(r, 10));

  // 3. Insert active artifact (most recent)
  await storage.putObject(`v1/feeds/${feedId}/artifacts/active-sha.zip`, Buffer.from('active'));

  const report = await cleanFeedHistoricArtifacts(storage, feedId, 'active-sha', {
    maxHistoricArtifactsPerFeed: 1, // keep active + 1 most recent previous
    dryRun: false,
  });

  assert.equal(report.retainedKeys.length, 2);
  assert.ok(report.retainedKeys.includes(`v1/feeds/${feedId}/artifacts/active-sha.zip`));
  assert.ok(report.retainedKeys.includes(`v1/feeds/${feedId}/artifacts/prev-sha.zip`));
  assert.equal(report.deletedKeys.length, 2);

  assert.equal(storage.hasKey(`v1/feeds/${feedId}/artifacts/active-sha.zip`), true);
  assert.equal(storage.hasKey(`v1/feeds/${feedId}/artifacts/prev-sha.zip`), true);
  assert.equal(storage.hasKey(`v1/feeds/${feedId}/artifacts/old1-sha.zip`), false);
  assert.equal(storage.hasKey(`v1/feeds/${feedId}/artifacts/old2-sha.zip`), false);
});

test('cleanFeedHistoricArtifacts in dryRun mode does not delete objects from storage', async () => {
  const storage = new MemoryR2Storage();
  const feedId = 'budapest';

  await storage.putObject(`v1/feeds/${feedId}/artifacts/old-sha.zip`, Buffer.from('old'));
  await new Promise((r) => setTimeout(r, 10));
  await storage.putObject(`v1/feeds/${feedId}/artifacts/active-sha.zip`, Buffer.from('active'));

  const report = await cleanFeedHistoricArtifacts(storage, feedId, 'active-sha', {
    maxHistoricArtifactsPerFeed: 0,
    dryRun: true,
  });

  assert.equal(report.deletedKeys.length, 1);
  assert.equal(storage.hasKey(`v1/feeds/${feedId}/artifacts/old-sha.zip`), true);
});
