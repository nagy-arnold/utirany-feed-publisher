import {
  AcquiredCandidate,
  DiscoveredTransitFeed,
  FeedPublicationStatus,
  RedistributionPolicy,
  SourceMetadata,
  TransitFeedSourceAdapter,
} from '../types.js';
import { MenetBrandClient } from './client.js';

export interface MenetBrandFeedMapping {
  readonly configId: string;
  readonly feedId: string;
  readonly displayName: string;
  readonly region: string;
  readonly defaultStatus: FeedPublicationStatus;
  readonly redistributionPolicy: RedistributionPolicy;
}

export const KNOWN_MENETBRAND_FEEDS: MenetBrandFeedMapping[] = [
  {
    configId: 'szeged',
    feedId: 'szeged',
    displayName: 'Szeged',
    region: 'Dél-Alföld',
    defaultStatus: 'APP_READY',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'mav_volan',
    feedId: 'mav-volan',
    displayName: 'MÁV-Start & Volánbusz (Országos)',
    region: 'Országos',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'pecs',
    feedId: 'pecs',
    displayName: 'Pécs',
    region: 'Dél-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'miskolc',
    feedId: 'miskolc',
    displayName: 'Miskolc',
    region: 'Észak-Magyarország',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'kecskemet',
    feedId: 'kecskemet',
    displayName: 'Kecskemét',
    region: 'Dél-Alföld',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'debrecen',
    feedId: 'debrecen',
    displayName: 'Debrecen',
    region: 'Észak-Alföld',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'kaposvar',
    feedId: 'kaposvar',
    displayName: 'Kaposvár',
    region: 'Dél-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'szombathely',
    feedId: 'szombathely',
    displayName: 'Szombathely',
    region: 'Nyugat-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'tatabanya',
    feedId: 'tatabanya',
    displayName: 'Tatabánya',
    region: 'Közép-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
  {
    configId: 'veszprem',
    feedId: 'veszprem',
    displayName: 'Veszprém',
    region: 'Közép-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  },
];

export class MenetBrandSourceAdapter implements TransitFeedSourceAdapter {
  readonly name = 'menetbrand';
  private readonly client: MenetBrandClient;
  private readonly feedMapping: Map<string, MenetBrandFeedMapping>;
  private readonly reverseMapping: Map<string, MenetBrandFeedMapping>;

  constructor(options: { client?: MenetBrandClient; mappings?: MenetBrandFeedMapping[] } = {}) {
    this.client = options.client ?? new MenetBrandClient();
    const mappings = options.mappings ?? KNOWN_MENETBRAND_FEEDS;
    this.feedMapping = new Map(mappings.map((m) => [m.configId, m]));
    this.reverseMapping = new Map(mappings.map((m) => [m.feedId, m]));
  }

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    if (!this.client.isConfigured) {
      return this.fallbackKnownFeeds();
    }

    try {
      const config = await this.client.config();
      const discovered: DiscoveredTransitFeed[] = [];

      // Inspect enabled release_configs
      for (const [key, rc] of Object.entries(config.release_configs)) {
        if (!rc.enabled && key !== 'szeged' && key !== 'mav_volan') continue;
        const configId = rc.config_id || key;
        const mapping = this.feedMapping.get(configId) ?? {
          configId,
          feedId: toStableFeedId(configId),
          displayName: formatDisplayName(configId),
          region: 'Magyarország',
          defaultStatus: 'RAW_MIRROR',
          redistributionPolicy: 'UNKNOWN',
        };

        const sourceMetadata: SourceMetadata = {
          provider: 'MenetBrand',
          authorityLevel: 'VERIFIED_AGGREGATOR',
          license: 'MenetBrand Partner Data',
          attribution: 'MenetBrand (menetbrand.com)',
          redistributionPolicy: mapping.redistributionPolicy,
          priority: 10,
          endpoint: `https://api.menetbrand.com/hungary/gtfs/download?config_id=${encodeURIComponent(configId)}`,
          notes: `Upstream config: ${configId}`,
        };

        discovered.push({
          feedId: mapping.feedId,
          displayName: mapping.displayName,
          region: mapping.region,
          preferredSource: sourceMetadata,
          allSources: [sourceMetadata],
          sourceHash: '',
          format: 'menetbrand_sqlite_v5',
          publicationStatus: mapping.defaultStatus,
        });
      }

      return discovered.sort((a, b) => a.feedId.localeCompare(b.feedId));
    } catch {
      return this.fallbackKnownFeeds();
    }
  }

  private fallbackKnownFeeds(): DiscoveredTransitFeed[] {
    return Array.from(this.feedMapping.values()).map((m) => {
      const sourceMetadata: SourceMetadata = {
        provider: 'MenetBrand',
        authorityLevel: 'VERIFIED_AGGREGATOR',
        license: 'MenetBrand Partner Data',
        attribution: 'MenetBrand (menetbrand.com)',
        redistributionPolicy: m.redistributionPolicy,
        priority: 10,
        endpoint: `https://api.menetbrand.com/hungary/gtfs/download?config_id=${encodeURIComponent(m.configId)}`,
      };
      return {
        feedId: m.feedId,
        displayName: m.displayName,
        region: m.region,
        preferredSource: sourceMetadata,
        allSources: [sourceMetadata],
        sourceHash: '',
        format: 'menetbrand_sqlite_v5',
        publicationStatus: m.defaultStatus,
      };
    });
  }

  async fetchMetadata(feedId: string): Promise<{
    sourceHash: string;
    coverageStart?: string;
    coverageEnd?: string;
    upstreamVersion?: string;
  } | null> {
    const mapping = this.reverseMapping.get(feedId);
    if (!mapping) return null;

    try {
      const info = await this.client.info(mapping.configId, '10');
      return {
        sourceHash: info.hash,
        coverageStart: info.trips_begin,
        coverageEnd: info.trips_end,
        upstreamVersion: info.created,
      };
    } catch {
      return null;
    }
  }

  async acquireCandidate(feed: DiscoveredTransitFeed): Promise<AcquiredCandidate> {
    const mapping = this.reverseMapping.get(feed.feedId);
    if (!mapping) {
      throw new Error(`Unknown feedId '${feed.feedId}' for MenetBrand adapter`);
    }

    const artifact = await this.client.download(mapping.configId, 'zip', '10');
    return {
      feedId: feed.feedId,
      sourceHash: feed.sourceHash,
      bytes: artifact.bytes,
      filename: artifact.filename ?? `${mapping.configId}.db`,
      contentType: artifact.contentType ?? 'application/octet-stream',
      acquiredAt: new Date().toISOString(),
      format: 'menetbrand_sqlite_v5',
      sourceMetadata: feed.preferredSource,
    };
  }
}

function toStableFeedId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/_+/g, '-').replace(/^-+|-+$/g, '');
}

function formatDisplayName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
