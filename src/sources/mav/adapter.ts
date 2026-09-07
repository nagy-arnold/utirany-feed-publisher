import {
  AcquiredCandidate,
  DiscoveredTransitFeed,
  SourceMetadata,
  TransitFeedSourceAdapter,
} from '../types.js';

export const MAV_OFFICIAL_SOURCE_METADATA: SourceMetadata = {
  provider: 'MÁV-START Zrt. / MÁV Csoport',
  authorityLevel: 'OFFICIAL_DIRECT',
  license: 'MÁV Csoport Egyedi Felhasználási Feltételek (Corporate Registration Required)',
  attribution: 'MÁV-START Zrt. (mavcsoport.hu)',
  redistributionPolicy: 'PRIVATE_ACQUISITION_ONLY',
  priority: 2,
  endpoint: 'https://www.mavcsoport.hu/gtfs-igenybejelento',
  notes: 'Direct official MÁV feed requires corporate registration and individual basic auth credentials',
};

export class MavOfficialGtfsSourceAdapter implements TransitFeedSourceAdapter {
  readonly name = 'mav_official';
  private readonly username?: string;
  private readonly password?: string;
  private readonly endpointUrl?: string;

  constructor(options: { username?: string; password?: string; endpointUrl?: string } = {}) {
    this.username = options.username ?? process.env.MAV_GTFS_USERNAME;
    this.password = options.password ?? process.env.MAV_GTFS_PASSWORD;
    this.endpointUrl = options.endpointUrl ?? process.env.MAV_GTFS_ENDPOINT_URL;
  }

  get isConfigured(): boolean {
    return Boolean(this.username && this.password && this.endpointUrl);
  }

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    // Honest representation: only claim operational feeds when credentials and endpoint are actually configured
    if (!this.isConfigured) {
      return [];
    }

    return [
      {
        feedId: 'mav-volan',
        displayName: 'MÁV-START & Volánbusz (Hivatalos MÁV Forrás)',
        region: 'Országos',
        preferredSource: MAV_OFFICIAL_SOURCE_METADATA,
        allSources: [MAV_OFFICIAL_SOURCE_METADATA],
        sourceHash: '',
        format: 'gtfs_zip',
        publicationStatus: 'RAW_MIRROR',
      },
    ];
  }

  async fetchMetadata(feedId: string): Promise<{
    sourceHash: string;
    coverageStart?: string;
    coverageEnd?: string;
    upstreamVersion?: string;
  } | null> {
    if (!this.isConfigured || feedId !== 'mav-volan') return null;
    return null;
  }

  async acquireCandidate(_feed: DiscoveredTransitFeed): Promise<AcquiredCandidate> {
    if (!this.isConfigured) {
      throw new Error(
        'Direct MÁV official GTFS source is not configured (requires registration via https://www.mavcsoport.hu/gtfs-igenybejelento). Use MenetBrand mav_volan as VERIFIED_AGGREGATOR.',
      );
    }
    throw new Error('MÁV official source acquisition not yet activated');
  }
}
