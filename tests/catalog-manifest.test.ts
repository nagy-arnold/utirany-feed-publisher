import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeedManifest, parseManifest, serializeManifest } from '../src/catalog/manifest.js';
import { buildCatalog, parseCatalog, serializeCatalog } from '../src/catalog/catalog.js';

test('createFeedManifest fulfills Android RemoteManifestDto contract', () => {
  const manifest = createFeedManifest({
    feedId: 'szeged',
    city: 'szeged',
    generation: 'gen-12345',
    sha256: 'ABCD1234EF56',
    byteSize: 1234567,
    publicBaseUrl: 'https://utirany-feed.tir-ny.workers.dev',
    artifactPath: 'v1/feeds/szeged/artifacts/abcd1234ef56.zip',
    metrics: {
      stopCount: 500,
      routeCount: 30,
      tripCount: 1500,
      stopTimeCount: 20000,
      shapeCount: 25,
      serviceCount: 5,
      coverageStart: '2026-09-01',
      coverageEnd: '2026-10-31',
      agencyTimeZone: 'Europe/Budapest',
    },
    sourceMetadata: {
      provider: 'MenetBrand',
      authorityLevel: 'VERIFIED_AGGREGATOR',
      license: 'Partner',
      attribution: 'MenetBrand',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 10,
    },
    status: 'APP_READY',
    sourceHash: 'src-hash-1',
    canonicalIdentityVersion: 1,
  });

  // Check Android RemoteManifestDto fields
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.city, 'szeged');
  assert.equal(manifest.generationId, 'gen-12345');
  assert.equal(manifest.contentSha256, 'abcd1234ef56');
  assert.equal(manifest.byteSize, 1234567);
  assert.equal(manifest.validFrom, '2026-09-01');
  assert.equal(manifest.validUntil, '2026-10-31');
  assert.equal(manifest.downloadUrl, 'https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/artifacts/abcd1234ef56.zip');

  // Check modern / publisher fields
  assert.equal(manifest.feedId, 'szeged');
  assert.equal(manifest.status, 'APP_READY');
  assert.equal(manifest.source.provider, 'MenetBrand');
  assert.equal(manifest.source.authorityLevel, 'VERIFIED_AGGREGATOR');

  // Check roundtrip JSON
  const json = serializeManifest(manifest);
  const parsed = parseManifest(json);
  assert.equal(parsed.feedId, manifest.feedId);
  assert.equal(parsed.generationId, manifest.generationId);
  assert.equal(parsed.downloadUrl, manifest.downloadUrl);
});

test('buildCatalog generates deterministically sorted feed entries with source authority', () => {
  const m1 = createFeedManifest({
    feedId: 'szeged',
    generation: 'g1',
    sha256: 'sha1',
    byteSize: 100,
    publicBaseUrl: 'https://example.com',
    artifactPath: 'v1/a1.zip',
    metrics: {} as any,
    sourceMetadata: { provider: 'MenetBrand', authorityLevel: 'VERIFIED_AGGREGATOR', license: 'P', attribution: 'MB', redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED', priority: 10 },
    status: 'APP_READY',
    sourceHash: 'h1',
  });

  const m2 = createFeedManifest({
    feedId: 'budapest',
    generation: 'g2',
    sha256: 'sha2',
    byteSize: 200,
    publicBaseUrl: 'https://example.com',
    artifactPath: 'v1/a2.zip',
    metrics: {} as any,
    sourceMetadata: { provider: 'BKK', authorityLevel: 'OFFICIAL_DIRECT', license: 'CC', attribution: 'BKK', redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED', priority: 1 },
    status: 'RAW_MIRROR',
    sourceHash: 'h2',
  });

  const catalog = buildCatalog([
    { manifest: m1, displayName: 'Szeged', region: 'Dél-Alföld' },
    { manifest: m2, displayName: 'Budapest', region: 'Közép-Magyarország' },
  ]);

  assert.equal(catalog.feeds.length, 2);
  // Deterministic order: 'budapest' before 'szeged'
  assert.equal(catalog.feeds[0].id, 'budapest');
  assert.equal(catalog.feeds[0].status, 'RAW_MIRROR');
  assert.equal(catalog.feeds[0].source.authorityLevel, 'OFFICIAL_DIRECT');

  assert.equal(catalog.feeds[1].id, 'szeged');
  assert.equal(catalog.feeds[1].status, 'APP_READY');
  assert.equal(catalog.feeds[1].source.authorityLevel, 'VERIFIED_AGGREGATOR');

  const json = serializeCatalog(catalog);
  const parsed = parseCatalog(json);
  assert.equal(parsed.feeds[0].id, 'budapest');
});
