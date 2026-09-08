import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/env.js';
import { createFeedManifest, serializeManifest } from '../src/catalog/manifest.js';
import { PublisherEngine } from '../src/publisher/engine.js';
import { MemoryR2Storage } from '../src/r2/memory.js';
import { QuotaExhaustedError } from '../src/sources/menetbrand/errors.js';
import { SourceRegistry } from '../src/sources/registry.js';
import { DiscoveredTransitFeed, TransitFeedSourceAdapter } from '../src/sources/types.js';

test('Quota circuit breaker: zero additional MenetBrand calls after quota exhaustion, preserves LKG, continues BKK', async () => {
  let menetbrandMetadataCalls = 0;
  let menetbrandDownloadCalls = 0;
  let bkkMetadataCalls = 0;
  let bkkDownloadCalls = 0;

  // Mock MenetBrand adapter that fails with QuotaExhaustedError on feed-1
  const mockMenetBrandAdapter: TransitFeedSourceAdapter = {
    name: 'menetbrand',
    discoverFeeds: async () => [
      {
        feedId: 'szeged',
        displayName: 'Szeged',
        region: 'Dél-Alföld',
        preferredSource: {
          provider: 'MenetBrand',
          authorityLevel: 'VERIFIED_AGGREGATOR',
          license: 'MenetBrand Partner Data',
          attribution: 'MenetBrand',
          redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
          priority: 10,
        },
        allSources: [],
        sourceHash: 'szeged-hash-1',
        format: 'menetbrand_sqlite_v5',
        publicationStatus: 'APP_READY',
      },
      {
        feedId: 'szeged-secondary',
        displayName: 'Szeged Secondary',
        region: 'Dél-Alföld',
        preferredSource: {
          provider: 'MenetBrand',
          authorityLevel: 'VERIFIED_AGGREGATOR',
          license: 'MenetBrand Partner Data',
          attribution: 'MenetBrand',
          redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
          priority: 10,
        },
        allSources: [],
        sourceHash: 'szeged-hash-2',
        format: 'menetbrand_sqlite_v5',
        publicationStatus: 'APP_READY',
      },
    ],
    fetchMetadata: async (feedId: string) => {
      menetbrandMetadataCalls++;
      // The first call hits the quota limit
      throw new QuotaExhaustedError('ERROR_API_KEY_LIMIT_REACHED: Daily quota exhausted');
    },
    acquireCandidate: async () => {
      menetbrandDownloadCalls++;
      throw new QuotaExhaustedError('ERROR_API_KEY_LIMIT_REACHED: Daily quota exhausted');
    },
  };

  // Mock BKK adapter that succeeds
  const mockBkkAdapter: TransitFeedSourceAdapter = {
    name: 'bkk_official',
    discoverFeeds: async () => [
      {
        feedId: 'budapest',
        displayName: 'Budapest',
        region: 'Közép-Magyarország',
        preferredSource: {
          provider: 'BKK Budapesti Közlekedési Központ',
          authorityLevel: 'OFFICIAL_DIRECT',
          license: 'BKK Open Data / CC-BY',
          attribution: 'BKK',
          redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
          priority: 1,
        },
        allSources: [],
        sourceHash: 'bkk-hash-1',
        format: 'gtfs_zip',
        publicationStatus: 'RAW_MIRROR',
      },
    ],
    fetchMetadata: async () => {
      bkkMetadataCalls++;
      return { sourceHash: 'bkk-hash-1' }; // Matches existing manifest -> skipped unchanged
    },
    acquireCandidate: async () => {
      bkkDownloadCalls++;
      throw new Error('Should not be called');
    },
  };

  const storage = new MemoryR2Storage();

  // Pre-seed LKG for szeged in storage
  const szegedLkg = createFeedManifest({
    feedId: 'szeged',
    city: 'szeged',
    generation: 'szeged-gen-lkg',
    sha256: 'a'.repeat(64),
    byteSize: 1000,
    publicBaseUrl: 'https://utirany-feed.test',
    artifactPath: 'v1/feeds/szeged/artifacts/lkg.zip',
    metrics: { stopCount: 100, routeCount: 10, tripCount: 50, stopTimeCount: 500, shapeCount: 5, serviceCount: 1, coverageStart: '2026-09-01', coverageEnd: '2026-10-31', agencyTimeZone: 'Europe/Budapest' },
    sourceMetadata: {
      provider: 'MenetBrand',
      authorityLevel: 'VERIFIED_AGGREGATOR',
      license: 'Test',
      attribution: 'MenetBrand',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 10,
    },
    status: 'APP_READY',
    sourceHash: 'szeged-hash-1',
  });
  await storage.putObject('v1/feeds/szeged/manifest.json', Buffer.from(serializeManifest(szegedLkg), 'utf8'));

  // Pre-seed LKG for budapest in storage
  const budapestLkg = createFeedManifest({
    feedId: 'budapest',
    city: 'budapest',
    generation: 'bkk-gen-lkg',
    sha256: 'b'.repeat(64),
    byteSize: 50000,
    publicBaseUrl: 'https://utirany-feed.test',
    artifactPath: 'v1/feeds/budapest/artifacts/lkg.zip',
    metrics: { stopCount: 5000, routeCount: 300, tripCount: 20000, stopTimeCount: 400000, shapeCount: 1000, serviceCount: 10, coverageStart: '2026-09-01', coverageEnd: '2026-10-31', agencyTimeZone: 'Europe/Budapest' },
    sourceMetadata: {
      provider: 'BKK',
      authorityLevel: 'OFFICIAL_DIRECT',
      license: 'CC-BY',
      attribution: 'BKK',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 100,
    },
    status: 'APP_READY',
    sourceHash: 'bkk-hash-1',
  });
  await storage.putObject('v1/feeds/budapest/manifest.json', Buffer.from(serializeManifest(budapestLkg), 'utf8'));

  const registry = new SourceRegistry([mockMenetBrandAdapter, mockBkkAdapter]);
  const config = loadConfig({
    MENETBRAND_API_KEY: 'test-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ACCESS_KEY_ID: 'test-key-id',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    PUBLIC_FEED_BASE_URL: 'https://utirany-feed.test',
  });

  const engine = new PublisherEngine(config, registry, storage);
  const summary = await engine.run();

  // 1. Quota circuit breaker tripped
  assert.equal(summary.menetbrandQuotaExhausted, true);

  // 2. Exact call count verification:
  // Exactly 1 metadata call to MenetBrand was attempted; once quota was exhausted,
  // NO download call was attempted (0 download calls) AND NO metadata call was made
  // for the second MenetBrand feed (0 subsequent calls).
  assert.equal(menetbrandMetadataCalls, 1);
  assert.equal(menetbrandDownloadCalls, 0);

  // 3. MenetBrand LKG was preserved
  const szegedResult = summary.feedResults.find((f) => f.feedId === 'szeged');
  assert.equal(szegedResult?.action, 'RETAINED_LKG');

  // 4. Independent provider (BKK) executed successfully
  assert.equal(bkkMetadataCalls, 1);
  const budapestResult = summary.feedResults.find((f) => f.feedId === 'budapest');
  assert.equal(budapestResult?.action, 'SKIPPED_UNCHANGED');
});

test('Discovery cache: executes discoverFeeds exactly once per adapter per run', async () => {
  let mbDiscoveryCount = 0;
  let bkkDiscoveryCount = 0;

  const mockMb: TransitFeedSourceAdapter = {
    name: 'menetbrand',
    discoverFeeds: async () => {
      mbDiscoveryCount++;
      return [];
    },
    fetchMetadata: async () => null,
    acquireCandidate: async () => { throw new Error('Not implemented'); },
  };

  const mockBkk: TransitFeedSourceAdapter = {
    name: 'bkk_official',
    discoverFeeds: async () => {
      bkkDiscoveryCount++;
      return [];
    },
    fetchMetadata: async () => null,
    acquireCandidate: async () => { throw new Error('Not implemented'); },
  };

  const registry = new SourceRegistry([mockMb, mockBkk]);

  // First call
  await registry.discoverAllFeeds();
  assert.equal(mbDiscoveryCount, 1, 'MenetBrand discovery must be called exactly once');
  assert.equal(bkkDiscoveryCount, 1, 'BKK discovery must be called exactly once');

  // Second call in same run (must return cached snapshot without calling adapters again)
  await registry.discoverAllFeeds();
  assert.equal(mbDiscoveryCount, 1, 'MenetBrand discovery must not be re-called');
  assert.equal(bkkDiscoveryCount, 1, 'BKK discovery must not be re-called');
});
