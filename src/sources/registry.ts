import { BkkStaticGtfsSourceAdapter } from './bkk/adapter.js';
import { MavOfficialGtfsSourceAdapter } from './mav/adapter.js';
import { MenetBrandSourceAdapter } from './menetbrand/adapter.js';
import { DiscoveredTransitFeed, SourceMetadata, TransitFeedSourceAdapter } from './types.js';

export interface FeedDefinition {
  readonly feedId: string;
  readonly displayName: string;
  readonly region: string;
  readonly preferredAdapter: string;
  readonly fallbackAdapters: string[];
}

export const CANONICAL_FEED_DEFINITIONS: FeedDefinition[] = [
  {
    feedId: 'szeged',
    displayName: 'Szeged',
    region: 'Dél-Alföld',
    preferredAdapter: 'menetbrand',
    fallbackAdapters: [],
  },
  {
    feedId: 'budapest',
    displayName: 'Budapest',
    region: 'Közép-Magyarország',
    preferredAdapter: 'bkk_official',
    fallbackAdapters: ['menetbrand'],
  },
  {
    feedId: 'mav-volan',
    displayName: 'MÁV-Start & Volánbusz (Országos)',
    region: 'Országos',
    preferredAdapter: 'menetbrand',
    fallbackAdapters: ['mav_official'],
  },
];

export class SourceRegistry {
  private readonly adapters: Map<string, TransitFeedSourceAdapter> = new Map();
  private cachedDiscoveredFeeds: DiscoveredTransitFeed[] | null = null;

  constructor(adapters: TransitFeedSourceAdapter[] = []) {
    for (const adapter of adapters) {
      this.registerAdapter(adapter);
    }
  }

  static createDefault(options: {
    menetbrandAdapter?: MenetBrandSourceAdapter;
    bkkAdapter?: BkkStaticGtfsSourceAdapter;
    mavAdapter?: MavOfficialGtfsSourceAdapter;
  } = {}): SourceRegistry {
    const registry = new SourceRegistry();
    registry.registerAdapter(options.bkkAdapter ?? new BkkStaticGtfsSourceAdapter());
    registry.registerAdapter(options.menetbrandAdapter ?? new MenetBrandSourceAdapter());
    registry.registerAdapter(options.mavAdapter ?? new MavOfficialGtfsSourceAdapter());
    return registry;
  }

  registerAdapter(adapter: TransitFeedSourceAdapter): void {
    this.adapters.set(adapter.name, adapter);
    this.cachedDiscoveredFeeds = null;
  }

  getAdapter(name: string): TransitFeedSourceAdapter | undefined {
    return this.adapters.get(name);
  }

  clearCache(): void {
    this.cachedDiscoveredFeeds = null;
  }

  async discoverAllFeeds(options: { forceRefresh?: boolean } = {}): Promise<DiscoveredTransitFeed[]> {
    if (!options.forceRefresh && this.cachedDiscoveredFeeds) {
      return this.cachedDiscoveredFeeds;
    }

    const allDiscovered = new Map<string, DiscoveredTransitFeed>();
    const adapterFeedsMap = new Map<string, DiscoveredTransitFeed[]>();

    // 1. Gather discovered feeds from each adapter exactly ONCE
    for (const [name, adapter] of this.adapters) {
      try {
        const feeds = await adapter.discoverFeeds();
        adapterFeedsMap.set(name, feeds);
        for (const feed of feeds) {
          const existing = allDiscovered.get(feed.feedId);
          if (!existing) {
            const allSources = feed.allSources.length > 0 ? feed.allSources : [feed.preferredSource];
            allDiscovered.set(feed.feedId, { ...feed, allSources });
          } else {
            const combinedSources: SourceMetadata[] = [
              ...existing.allSources,
              ...feed.allSources.filter(
                (s) => !existing.allSources.some((es) => es.provider === s.provider),
              ),
            ];
            if (!combinedSources.some((s) => s.provider === feed.preferredSource.provider)) {
              combinedSources.push(feed.preferredSource);
            }
            combinedSources.sort((a, b) => a.priority - b.priority);

            const preferredSource = combinedSources[0] ?? existing.preferredSource;

            allDiscovered.set(feed.feedId, {
              ...existing,
              preferredSource,
              allSources: combinedSources,
            });
          }
        }
      } catch {
        adapterFeedsMap.set(name, []);
        // Ignore single adapter discovery failure
      }
    }

    // 2. Align with known canonical feed priorities using the in-memory snapshot (NO duplicate discovery calls!)
    for (const def of CANONICAL_FEED_DEFINITIONS) {
      const feed = allDiscovered.get(def.feedId);
      if (feed) {
        const adapterFeeds = adapterFeedsMap.get(def.preferredAdapter) ?? [];
        const preferredFeed = adapterFeeds.find((f) => f.feedId === def.feedId);
        if (preferredFeed) {
          allDiscovered.set(def.feedId, {
            ...feed,
            preferredSource: preferredFeed.preferredSource,
            format: preferredFeed.format,
            publicationStatus: def.feedId === 'szeged' ? 'APP_READY' : 'RAW_MIRROR',
          });
        }
      }
    }

    const result = Array.from(allDiscovered.values()).sort((a, b) => a.feedId.localeCompare(b.feedId));
    this.cachedDiscoveredFeeds = result;
    return result;
  }

  getAdapterForFeed(feed: DiscoveredTransitFeed): TransitFeedSourceAdapter {
    const provider = feed.preferredSource.provider.toLowerCase();
    if (provider.includes('bkk')) {
      return this.adapters.get('bkk_official') ?? this.fallbackAdapter();
    }
    if (provider.includes('máv-start') && this.adapters.get('mav_official')) {
      return this.adapters.get('mav_official')!;
    }
    return this.adapters.get('menetbrand') ?? this.fallbackAdapter();
  }

  private fallbackAdapter(): TransitFeedSourceAdapter {
    const first = this.adapters.values().next().value;
    if (!first) throw new Error('No source adapters registered');
    return first;
  }
}
