import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceRegistry } from '../src/sources/registry.js';
import { DiscoveredTransitFeed, TransitFeedSourceAdapter } from '../src/sources/types.js';

class FakeAdapter implements TransitFeedSourceAdapter {
  constructor(
    readonly name: string,
    private readonly feeds: DiscoveredTransitFeed[],
  ) {}

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    return this.feeds;
  }

  async fetchMetadata(): Promise<any> {
    return null;
  }

  async acquireCandidate(): Promise<any> {
    throw new Error('Not implemented');
  }
}

test('SourceRegistry aggregates feeds from multiple adapters and prioritizes preferred source', async () => {
  const bkkFeed: DiscoveredTransitFeed = {
    feedId: 'budapest',
    displayName: 'Budapest',
    region: 'Közép-Magyarország',
    preferredSource: {
      provider: 'BKK',
      authorityLevel: 'OFFICIAL_DIRECT',
      license: 'CC-BY',
      attribution: 'BKK',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 1,
    },
    allSources: [],
    sourceHash: 'bkk-hash-1',
    format: 'gtfs_zip',
    publicationStatus: 'RAW_MIRROR',
  };

  const menetbrandFeed: DiscoveredTransitFeed = {
    feedId: 'budapest',
    displayName: 'Budapest',
    region: 'Közép-Magyarország',
    preferredSource: {
      provider: 'MenetBrand',
      authorityLevel: 'VERIFIED_AGGREGATOR',
      license: 'Partner',
      attribution: 'MenetBrand',
      redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
      priority: 10,
    },
    allSources: [],
    sourceHash: 'mb-hash-1',
    format: 'menetbrand_sqlite_v5',
    publicationStatus: 'RAW_MIRROR',
  };

  const registry = new SourceRegistry([
    new FakeAdapter('bkk', [bkkFeed]),
    new FakeAdapter('menetbrand', [menetbrandFeed]),
  ]);

  const feeds = await registry.discoverAllFeeds();
  assert.equal(feeds.length, 1);
  const feed = feeds[0];
  assert.equal(feed.feedId, 'budapest');
  assert.equal(feed.preferredSource.provider, 'BKK');
  assert.equal(feed.preferredSource.authorityLevel, 'OFFICIAL_DIRECT');
  assert.equal(feed.allSources.length, 2);
});

test('SourceRegistry enforces stable public feed IDs and correct initial statuses', async () => {
  const registry = SourceRegistry.createDefault();
  const feeds = await registry.discoverAllFeeds();

  const szeged = feeds.find((f) => f.feedId === 'szeged');
  assert.ok(szeged);
  assert.equal(szeged.publicationStatus, 'APP_READY');

  const budapest = feeds.find((f) => f.feedId === 'budapest');
  assert.ok(budapest);
  assert.equal(budapest.publicationStatus, 'RAW_MIRROR');
  assert.equal(budapest.preferredSource.authorityLevel, 'OFFICIAL_DIRECT');

  const mav = feeds.find((f) => f.feedId === 'mav-volan');
  assert.ok(mav);
  assert.equal(mav.publicationStatus, 'RAW_MIRROR');
});
