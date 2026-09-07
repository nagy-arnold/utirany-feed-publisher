import assert from 'node:assert/strict';
import test from 'node:test';
import { PublisherEngine } from '../src/publisher/engine.js';
import { MemoryR2Storage } from '../src/r2/memory.js';
import { SourceRegistry } from '../src/sources/registry.js';
import { DiscoveredTransitFeed, TransitFeedSourceAdapter, AcquiredCandidate } from '../src/sources/types.js';
import { loadConfig } from '../src/config/env.js';
import { createZip } from '../src/gtfs/zip.js';

function validSampleFeed(): Map<string, string> {
  return new Map([
    ['agency.txt', 'agency_id,agency_name,agency_url,agency_timezone\nAG,Test,http://test,Europe/Budapest\n'],
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nS1,Stop 1,46.25,20.14\nS2,Stop 2,46.26,20.15\nS3,Stop 3,46.27,20.16\nS4,Stop 4,46.28,20.17\nS5,Stop 5,46.29,20.18\nS6,Stop 6,46.30,20.19\nS7,Stop 7,46.31,20.20\nS8,Stop 8,46.32,20.21\nS9,Stop 9,46.33,20.22\nS10,Stop 10,46.34,20.23\n'],
    ['routes.txt', 'route_id,route_short_name,route_type\nR1,1,3\n'],
    ['trips.txt', 'trip_id,route_id,service_id\nT1,R1,S1\n'],
    ['stop_times.txt', 'trip_id,stop_sequence,stop_id,arrival_time,departure_time\nT1,1,S1,08:00:00,08:01:00\nT1,2,S2,08:05:00,08:06:00\n'],
    ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,1,1,20260901,20261031\n'],
  ]);
}

class TestMockAdapter implements TransitFeedSourceAdapter {
  readonly name = 'test_mock';
  constructor(
    private readonly feed: DiscoveredTransitFeed,
    private readonly zipBytes: Buffer,
  ) {}

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    return [this.feed];
  }

  async fetchMetadata(): Promise<any> {
    return { sourceHash: this.feed.sourceHash };
  }

  async acquireCandidate(): Promise<AcquiredCandidate> {
    return {
      feedId: this.feed.feedId,
      sourceHash: this.feed.sourceHash,
      bytes: this.zipBytes,
      format: 'gtfs_zip',
      sourceMetadata: this.feed.preferredSource,
      acquiredAt: new Date().toISOString(),
    };
  }
}

test('PublisherEngine guarantees atomic publication: artifact uploaded before manifest', async () => {
  const feed: DiscoveredTransitFeed = {
    feedId: 'test-feed',
    displayName: 'Test Feed',
    region: 'Region',
    preferredSource: {
      provider: 'Test',
      authorityLevel: 'OFFICIAL_DIRECT',
      license: 'Public',
      attribution: 'Test',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 1,
    },
    allSources: [],
    sourceHash: 'hash-v1',
    format: 'gtfs_zip',
    publicationStatus: 'RAW_MIRROR',
  };

  const zipBytes = createZip(validSampleFeed());
  const adapter = new TestMockAdapter(feed, zipBytes);
  const registry = new SourceRegistry([adapter]);
  const storage = new MemoryR2Storage();
  const config = loadConfig({ PUBLIC_FEED_BASE_URL: 'https://test.workers.dev' });

  const engine = new PublisherEngine(config, registry, storage);
  const summary = await engine.run();

  assert.equal(summary.publishedCount, 1);
  assert.ok(storage.hasKey('v1/feeds/test-feed/manifest.json'));
  assert.ok(storage.hasKey('v1/catalog.json'));

  // Verify that an artifact exists for the SHA mentioned in manifest
  const manifestObj = await storage.getObject('v1/feeds/test-feed/manifest.json');
  const manifest = JSON.parse(manifestObj!.body.toString('utf8'));
  const artifactKey = `v1/feeds/test-feed/artifacts/${manifest.sha256}.zip`;
  assert.ok(storage.hasKey(artifactKey));
});

test('PublisherEngine skips re-download when source hash is unchanged', async () => {
  const feed: DiscoveredTransitFeed = {
    feedId: 'test-feed',
    displayName: 'Test Feed',
    region: 'Region',
    preferredSource: {
      provider: 'Test',
      authorityLevel: 'OFFICIAL_DIRECT',
      license: 'Public',
      attribution: 'Test',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 1,
    },
    allSources: [],
    sourceHash: 'hash-v1',
    format: 'gtfs_zip',
    publicationStatus: 'RAW_MIRROR',
  };

  let downloadCalls = 0;
  class CountingAdapter implements TransitFeedSourceAdapter {
    readonly name = 'counting';
    async discoverFeeds() { return [feed]; }
    async fetchMetadata() { return { sourceHash: 'hash-v1' }; }
    async acquireCandidate(): Promise<AcquiredCandidate> {
      downloadCalls++;
      return {
        feedId: 'test-feed',
        sourceHash: 'hash-v1',
        bytes: createZip(validSampleFeed()),
        format: 'gtfs_zip',
        sourceMetadata: feed.preferredSource,
        acquiredAt: new Date().toISOString(),
      };
    }
  }

  const adapter = new CountingAdapter();
  const registry = new SourceRegistry([adapter as any]);
  const storage = new MemoryR2Storage();
  const config = loadConfig();

  const engine = new PublisherEngine(config, registry, storage);

  // Run 1: initial publish
  await engine.run();
  assert.equal(downloadCalls, 1);

  // Run 2: same source hash
  const summary2 = await engine.run();
  assert.equal(downloadCalls, 1); // Not called again!
  assert.equal(summary2.unchangedCount, 1);
});

test('PublisherEngine strictly enforces redistribution policy (User Requirement #3)', async () => {
  const gatedFeed: DiscoveredTransitFeed = {
    feedId: 'secret-feed',
    displayName: 'Secret Feed',
    region: 'Private',
    preferredSource: {
      provider: 'Private Partner',
      authorityLevel: 'VERIFIED_AGGREGATOR',
      license: 'Confidential',
      attribution: 'Private',
      redistributionPolicy: 'PRIVATE_ACQUISITION_ONLY',
      priority: 1,
    },
    allSources: [],
    sourceHash: 'secret-hash',
    format: 'gtfs_zip',
    publicationStatus: 'RAW_MIRROR',
  };

  const adapter = new TestMockAdapter(gatedFeed, createZip(validSampleFeed()));
  const registry = new SourceRegistry([adapter]);
  const storage = new MemoryR2Storage();
  const config = loadConfig();

  const engine = new PublisherEngine(config, registry, storage);
  const summary = await engine.run();

  assert.equal(summary.gatedCount, 1);
  assert.equal(summary.publishedCount, 0);
  assert.equal(storage.hasKey('v1/feeds/secret-feed/manifest.json'), false);
  assert.equal(storage.hasKey('v1/catalog.json'), false);
});
