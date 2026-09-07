import {
  AcquiredCandidate,
  DiscoveredTransitFeed,
  FeedPublicationStatus,
  RedistributionPolicy,
  SourceMetadata,
  TransitFeedSourceAdapter,
} from '../types.js';
import { MenetBrandClient } from './client.js';
import { QuotaExhaustedError } from './errors.js';
import { extractMenetBrandDatabase, validateMenetBrandDatabaseSchema } from './extract.js';

export interface MenetBrandFeedMapping {
  readonly configId: string;
  readonly feedId: string;
  readonly displayName: string;
  readonly region: string;
  readonly defaultStatus: FeedPublicationStatus;
  readonly redistributionPolicy: RedistributionPolicy;
}

/**
 * Feeds available through MenetBrand.
 * Note: Following OX-DATA-3.1 redistribution policy audit, only Szeged canonical feed
 * is classified as PUBLIC_REDISTRIBUTION_ALLOWED. All other aggregator feeds without
 * independently verified redistribution rights are classified as UNKNOWN.
 */
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
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'pecs',
    feedId: 'pecs',
    displayName: 'Pécs',
    region: 'Dél-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'miskolc',
    feedId: 'miskolc',
    displayName: 'Miskolc',
    region: 'Észak-Magyarország',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'kecskemet',
    feedId: 'kecskemet',
    displayName: 'Kecskemét',
    region: 'Dél-Alföld',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'debrecen',
    feedId: 'debrecen',
    displayName: 'Debrecen',
    region: 'Észak-Alföld',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'kaposvar',
    feedId: 'kaposvar',
    displayName: 'Kaposvár',
    region: 'Dél-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'szombathely',
    feedId: 'szombathely',
    displayName: 'Szombathely',
    region: 'Nyugat-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'tatabanya',
    feedId: 'tatabanya',
    displayName: 'Tatabánya',
    region: 'Közép-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
  {
    configId: 'veszprem',
    feedId: 'veszprem',
    displayName: 'Veszprém',
    region: 'Közép-Dunántúl',
    defaultStatus: 'RAW_MIRROR',
    redistributionPolicy: 'UNKNOWN',
  },
];

export class MenetBrandSourceAdapter implements TransitFeedSourceAdapter {
  readonly name = 'menetbrand';
  private readonly client: MenetBrandClient;
  private readonly feedMapping: Map<string, MenetBrandFeedMapping>;
  private readonly reverseMapping: Map<string, MenetBrandFeedMapping>;
  private isCircuitBroken = false;
  private circuitBrokenError: QuotaExhaustedError | null = null;

  constructor(options: { client?: MenetBrandClient; mappings?: MenetBrandFeedMapping[] } = {}) {
    this.client = options.client ?? new MenetBrandClient();
    const mappings = options.mappings ?? KNOWN_MENETBRAND_FEEDS;
    this.feedMapping = new Map(mappings.map((m) => [m.configId, m]));
    this.reverseMapping = new Map(mappings.map((m) => [m.feedId, m]));
  }

  get isCircuitBreakerTripped(): boolean {
    return this.isCircuitBroken;
  }

  resetCircuitBreaker(): void {
    this.isCircuitBroken = false;
    this.circuitBrokenError = null;
  }

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    if (this.isCircuitBroken) {
      return this.fallbackKnownFeeds();
    }

    if (!this.client.isConfigured) {
      return this.fallbackKnownFeeds();
    }

    try {
      const config = await this.client.config();
      const discovered: DiscoveredTransitFeed[] = [];

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
    } catch (err: any) {
      if (err instanceof QuotaExhaustedError || err.message?.includes('ERROR_API_KEY_LIMIT_REACHED')) {
        this.tripCircuitBreaker(err);
      }
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
    if (this.isCircuitBroken) {
      throw this.circuitBrokenError ?? new QuotaExhaustedError('MenetBrand circuit breaker is active (quota exceeded)');
    }

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
    } catch (err: any) {
      if (err instanceof QuotaExhaustedError || err.message?.includes('ERROR_API_KEY_LIMIT_REACHED')) {
        this.tripCircuitBreaker(err);
        throw this.circuitBrokenError;
      }
      return null;
    }
  }

  async acquireCandidate(feed: DiscoveredTransitFeed): Promise<AcquiredCandidate> {
    if (this.isCircuitBroken) {
      throw this.circuitBrokenError ?? new QuotaExhaustedError('MenetBrand circuit breaker is active (quota exceeded)');
    }

    const mapping = this.reverseMapping.get(feed.feedId);
    if (!mapping) {
      throw new Error(`Unknown feedId '${feed.feedId}' for MenetBrand adapter`);
    }

    let artifact: { bytes: Buffer; filename?: string | null; contentType?: string | null };
    try {
      artifact = await this.client.download(mapping.configId, 'zip', '10');
    } catch (err: any) {
      if (err instanceof QuotaExhaustedError || err.message?.includes('ERROR_API_KEY_LIMIT_REACHED')) {
        this.tripCircuitBreaker(err);
        throw this.circuitBrokenError;
      }
      throw err;
    }

    // Safely extract SQLite database from ZIP archive and verify SQLite signature and schema
    const extracted = extractMenetBrandDatabase(artifact.bytes);
    const schemaVal = validateMenetBrandDatabaseSchema(extracted.databaseBuffer);
    if (!schemaVal.isValid) {
      throw new Error(`Invalid MenetBrand SQLite v5 schema for '${feed.feedId}': ${schemaVal.issues.join('; ')}`);
    }

    return {
      feedId: feed.feedId,
      sourceHash: feed.sourceHash,
      bytes: extracted.databaseBuffer,
      filename: `${mapping.configId}.db`,
      contentType: 'application/x-sqlite3',
      acquiredAt: new Date().toISOString(),
      format: 'menetbrand_sqlite_v5',
      sourceMetadata: feed.preferredSource,
    };
  }

  private tripCircuitBreaker(err: any): void {
    this.isCircuitBroken = true;
    this.circuitBrokenError =
      err instanceof QuotaExhaustedError
        ? err
        : new QuotaExhaustedError(err?.message ?? 'MenetBrand daily API quota exceeded');
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
