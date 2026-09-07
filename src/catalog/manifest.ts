import { GtfsMetrics } from '../gtfs/validator.js';
import { FeedPublicationStatus, SourceMetadata } from '../sources/types.js';

export interface FeedManifest {
  readonly schemaVersion: 1;
  readonly feedId: string;
  readonly city: string;
  readonly generationId: string;
  readonly generation: string;
  readonly contentSha256: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly sizeBytes: number;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly coverageStart: string | null;
  readonly coverageEnd: string | null;
  readonly publishedAt: string;
  readonly downloadUrl: string;
  readonly artifactUrl: string;
  readonly sourceHash: string;
  readonly status: FeedPublicationStatus;
  readonly source: {
    readonly provider: string;
    readonly authorityLevel: string;
    readonly license: string;
    readonly attribution: string;
  };
  readonly canonicalIdentityVersion?: number;
  readonly metrics?: {
    readonly stops: number;
    readonly routes: number;
    readonly trips: number;
    readonly stopTimes: number;
    readonly shapes: number;
  };
}

export function createFeedManifest(args: {
  feedId: string;
  city?: string;
  generation: string;
  sha256: string;
  byteSize: number;
  publicBaseUrl: string;
  artifactPath: string;
  metrics: GtfsMetrics;
  sourceMetadata: SourceMetadata;
  status: FeedPublicationStatus;
  sourceHash: string;
  publishedAt?: string;
  canonicalIdentityVersion?: number;
}): FeedManifest {
  const publishedAt = args.publishedAt ?? new Date().toISOString();
  const cleanBase = args.publicBaseUrl.replace(/\/+$/, '');
  const cleanPath = args.artifactPath.replace(/^\/+/, '');
  const fullArtifactUrl = `${cleanBase}/${cleanPath}`;

  const validFrom = args.metrics.coverageStart;
  const validUntil = args.metrics.coverageEnd;

  return {
    schemaVersion: 1,
    feedId: args.feedId,
    city: args.city ?? args.feedId,
    generationId: args.generation,
    generation: args.generation,
    contentSha256: args.sha256.toLowerCase(),
    sha256: args.sha256.toLowerCase(),
    byteSize: args.byteSize,
    sizeBytes: args.byteSize,
    validFrom,
    validUntil,
    coverageStart: validFrom,
    coverageEnd: validUntil,
    publishedAt,
    downloadUrl: fullArtifactUrl,
    artifactUrl: fullArtifactUrl,
    sourceHash: args.sourceHash,
    status: args.status,
    source: {
      provider: args.sourceMetadata.provider,
      authorityLevel: args.sourceMetadata.authorityLevel,
      license: args.sourceMetadata.license,
      attribution: args.sourceMetadata.attribution,
    },
    canonicalIdentityVersion: args.canonicalIdentityVersion,
    metrics: {
      stops: args.metrics.stopCount,
      routes: args.metrics.routeCount,
      trips: args.metrics.tripCount,
      stopTimes: args.metrics.stopTimeCount,
      shapes: args.metrics.shapeCount,
    },
  };
}

export function serializeManifest(manifest: FeedManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function parseManifest(jsonStr: string): FeedManifest {
  return JSON.parse(jsonStr) as FeedManifest;
}
