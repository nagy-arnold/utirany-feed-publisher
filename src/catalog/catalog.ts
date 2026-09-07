import { FeedManifest } from './manifest.js';
import { FeedPublicationStatus } from '../sources/types.js';

export interface CatalogFeedEntry {
  readonly id: string;
  readonly displayName: string;
  readonly status: FeedPublicationStatus;
  readonly region: string;
  readonly coverageStart: string | null;
  readonly coverageEnd: string | null;
  readonly manifest: string;
  readonly updatedAt: string;
  readonly sizeBytes: number;
  readonly source: {
    readonly provider: string;
    readonly authorityLevel: string;
    readonly license: string;
    readonly attribution: string;
  };
}

export interface NationwideCatalog {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly feeds: CatalogFeedEntry[];
}

export function buildCatalog(
  manifests: Array<{ manifest: FeedManifest; displayName: string; region: string }>,
  generatedAt: string = new Date().toISOString(),
): NationwideCatalog {
  const entries: CatalogFeedEntry[] = manifests.map(({ manifest, displayName, region }) => ({
    id: manifest.feedId,
    displayName,
    status: manifest.status,
    region,
    coverageStart: manifest.coverageStart,
    coverageEnd: manifest.coverageEnd,
    manifest: `/v1/feeds/${manifest.feedId}/manifest.json`,
    updatedAt: manifest.publishedAt,
    sizeBytes: manifest.sizeBytes,
    source: manifest.source,
  }));

  entries.sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    generatedAt,
    feeds: entries,
  };
}

export function serializeCatalog(catalog: NationwideCatalog): string {
  return JSON.stringify(catalog, null, 2) + '\n';
}

export function parseCatalog(jsonStr: string): NationwideCatalog {
  return JSON.parse(jsonStr) as NationwideCatalog;
}
