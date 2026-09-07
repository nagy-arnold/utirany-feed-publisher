export type AuthorityLevel = 'OFFICIAL_DIRECT' | 'VERIFIED_AGGREGATOR' | 'FALLBACK';

export type RedistributionPolicy =
  | 'PUBLIC_REDISTRIBUTION_ALLOWED'
  | 'PRIVATE_ACQUISITION_ONLY'
  | 'UNKNOWN';

export type FeedPublicationStatus = 'APP_READY' | 'RAW_MIRROR';

export interface SourceMetadata {
  readonly provider: string;
  readonly authorityLevel: AuthorityLevel;
  readonly license: string;
  readonly attribution: string;
  readonly redistributionPolicy: RedistributionPolicy;
  readonly priority: number;
  readonly endpoint?: string;
  readonly notes?: string;
}

export interface DiscoveredTransitFeed {
  readonly feedId: string;
  readonly displayName: string;
  readonly region: string;
  readonly preferredSource: SourceMetadata;
  readonly allSources: SourceMetadata[];
  readonly sourceHash: string;
  readonly coverageStart?: string;
  readonly coverageEnd?: string;
  readonly upstreamVersion?: string;
  readonly format: 'gtfs_zip' | 'menetbrand_sqlite_v5';
  readonly publicationStatus: FeedPublicationStatus;
}

export interface AcquiredCandidate {
  readonly feedId: string;
  readonly sourceHash: string;
  readonly bytes: Buffer;
  readonly filename?: string;
  readonly contentType?: string;
  readonly acquiredAt: string;
  readonly format: 'gtfs_zip' | 'menetbrand_sqlite_v5';
  readonly sourceMetadata: SourceMetadata;
}

export interface TransitFeedSourceAdapter {
  readonly name: string;
  discoverFeeds(): Promise<DiscoveredTransitFeed[]>;
  fetchMetadata(feedId: string): Promise<{
    sourceHash: string;
    coverageStart?: string;
    coverageEnd?: string;
    upstreamVersion?: string;
  } | null>;
  acquireCandidate(feed: DiscoveredTransitFeed): Promise<AcquiredCandidate>;
}
