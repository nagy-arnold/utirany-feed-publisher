import { createHash } from 'node:crypto';
import {
  AcquiredCandidate,
  DiscoveredTransitFeed,
  SourceMetadata,
  TransitFeedSourceAdapter,
} from '../types.js';

export const BKK_SOURCE_METADATA: SourceMetadata = {
  provider: 'BKK Budapesti Közlekedési Központ',
  authorityLevel: 'OFFICIAL_DIRECT',
  license: 'BKK Open Data / CC-BY',
  attribution: 'BKK Budapesti Közlekedési Központ (bkk.hu)',
  redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
  priority: 1,
  endpoint: 'https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip',
  notes: 'Official BKK open data static GTFS archive',
};

export class BkkStaticGtfsSourceAdapter implements TransitFeedSourceAdapter {
  readonly name = 'bkk_official';
  private readonly endpointUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { endpointUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.endpointUrl =
      options.endpointUrl ?? 'https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async discoverFeeds(): Promise<DiscoveredTransitFeed[]> {
    const meta = await this.fetchMetadata('budapest');
    const sourceHash = meta?.sourceHash ?? 'bkk-static-gtfs';

    return [
      {
        feedId: 'budapest',
        displayName: 'Budapest',
        region: 'Közép-Magyarország',
        preferredSource: BKK_SOURCE_METADATA,
        allSources: [BKK_SOURCE_METADATA],
        sourceHash,
        coverageStart: meta?.coverageStart,
        coverageEnd: meta?.coverageEnd,
        upstreamVersion: meta?.upstreamVersion,
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
    if (feedId !== 'budapest') return null;

    try {
      const response = await this.fetchImpl(this.endpointUrl, {
        method: 'HEAD',
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new Error(`BKK GTFS metadata request failed with HTTP ${response.status}`);
      }

      const etag = response.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '').trim();
      const lastModified = response.headers.get('last-modified')?.trim();
      const contentLength = response.headers.get('content-length')?.trim();

      const hashInput = etag ?? (lastModified ? `${lastModified}-${contentLength}` : 'bkk-latest');
      const sourceHash = createHash('sha256').update(hashInput).digest('hex');

      return {
        sourceHash,
        upstreamVersion: etag || lastModified || undefined,
      };
    } catch {
      return null;
    }
  }

  async acquireCandidate(feed: DiscoveredTransitFeed): Promise<AcquiredCandidate> {
    const response = await this.fetchImpl(this.endpointUrl, {
      method: 'GET',
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`BKK GTFS download failed with HTTP ${response.status}`);
    }

    const arrayBuf = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    return {
      feedId: feed.feedId,
      sourceHash: feed.sourceHash || contentHash,
      bytes,
      filename: 'budapest_gtfs.zip',
      contentType: response.headers.get('content-type') || 'application/zip',
      acquiredAt: new Date().toISOString(),
      format: 'gtfs_zip',
      sourceMetadata: BKK_SOURCE_METADATA,
    };
  }
}
