import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CanonicalRegistry } from '../canonical/registry.js';
import { canonicalizeGtfsFiles } from '../canonical/canonicalize.js';
import { buildCatalog, serializeCatalog } from '../catalog/catalog.js';
import { createFeedManifest, parseManifest, serializeManifest, FeedManifest } from '../catalog/manifest.js';
import { PublisherConfig } from '../config/env.js';
import { checkCatastropheDrop } from '../gtfs/catastrophe.js';
import { exportMenetBrandDatabaseToGtfs } from '../gtfs/export.js';
import { validateGtfsPackage, GtfsValidationResult } from '../gtfs/validator.js';
import { createZip, readZipEntries } from '../gtfs/zip.js';
import { MemoryR2Storage } from '../r2/memory.js';
import { S3R2Storage } from '../r2/client.js';
import { R2Storage } from '../r2/types.js';
import { QuotaExhaustedError } from '../sources/menetbrand/errors.js';
import { SourceRegistry } from '../sources/registry.js';
import { DiscoveredTransitFeed } from '../sources/types.js';
import { cleanFeedHistoricArtifacts } from './retention.js';
import { PublisherRunSummary } from './summary.js';

export interface PublishOptions {
  readonly dryRun?: boolean;
  readonly targetFeedId?: string;
  readonly seededFeedFiles?: Map<string, string>; // optional pre-seeded canonical GTFS for initial deploy
}

export class PublisherEngine {
  private readonly config: PublisherConfig;
  private readonly sourceRegistry: SourceRegistry;
  private readonly storage: R2Storage;
  private readonly canonicalRegistry?: CanonicalRegistry;

  constructor(
    config: PublisherConfig,
    sourceRegistry: SourceRegistry,
    storage?: R2Storage,
    canonicalRegistry?: CanonicalRegistry,
  ) {
    this.config = config;
    this.sourceRegistry = sourceRegistry;
    this.storage =
      storage ?? (config.hasR2Credentials && !config.isDryRun ? new S3R2Storage(config) : new MemoryR2Storage());
    this.canonicalRegistry = canonicalRegistry;
  }

  async run(options: PublishOptions = {}): Promise<PublisherRunSummary> {
    const startTime = new Date();
    const isDryRun = options.dryRun ?? this.config.isDryRun;

    const feeds = await this.sourceRegistry.discoverAllFeeds();
    const filteredFeeds = options.targetFeedId
      ? feeds.filter((f) => f.feedId === options.targetFeedId)
      : feeds;

    let metadataCheckedCount = 0;
    let unchangedCount = 0;
    let downloadedCount = 0;
    let publishedCount = 0;
    let rejectedCount = 0;
    let gatedCount = 0;
    let menetbrandQuotaExhausted = false;

    const activeManifests: Array<{ manifest: FeedManifest; displayName: string; region: string }> = [];
    const feedResults: PublisherRunSummary['feedResults'][number][] = [];

    for (const feed of filteredFeeds) {
      // 1. HARD ENFORCEMENT: Licensing & Redistribution Gate (User Requirement #3)
      if (feed.preferredSource.redistributionPolicy !== 'PUBLIC_REDISTRIBUTION_ALLOWED') {
        gatedCount++;
        feedResults.push({
          feedId: feed.feedId,
          status: feed.publicationStatus,
          action: 'GATED_LICENSE',
          message: `Public mirroring gated: redistribution policy is '${feed.preferredSource.redistributionPolicy}' (evidence required for public R2 namespace)`,
        });
        continue;
      }

      const manifestKey = `v1/feeds/${feed.feedId}/manifest.json`;
      const existingManifestObj = await this.storage.getObject(manifestKey);
      let existingManifest: FeedManifest | null = null;
      if (existingManifestObj) {
        try {
          existingManifest = parseManifest(existingManifestObj.body.toString('utf8'));
        } catch {}
      }

      const adapter = this.sourceRegistry.getAdapterForFeed(feed);

      // Check if MenetBrand circuit breaker has already tripped in this run
      if (adapter.name === 'menetbrand' && menetbrandQuotaExhausted) {
        if (existingManifest) {
          activeManifests.push({
            manifest: existingManifest,
            displayName: feed.displayName,
            region: feed.region,
          });
          feedResults.push({
            feedId: feed.feedId,
            status: existingManifest.status,
            action: 'RETAINED_LKG',
            message: `MenetBrand API quota exhausted (circuit breaker tripped). 0 calls made; retaining active LKG.`,
            sizeBytes: existingManifest.sizeBytes,
            sha256: existingManifest.sha256,
          });
        } else {
          feedResults.push({
            feedId: feed.feedId,
            status: feed.publicationStatus,
            action: 'FAILED',
            message: `MenetBrand API quota exhausted (circuit breaker tripped). No prior LKG.`,
          });
        }
        continue;
      }

      // 2. Metadata check to avoid unnecessary downloads
      metadataCheckedCount++;
      let meta: { sourceHash: string; coverageStart?: string; coverageEnd?: string; upstreamVersion?: string } | null = null;
      try {
        meta = await adapter.fetchMetadata(feed.feedId);
      } catch (err: any) {
        if (
          err instanceof QuotaExhaustedError ||
          err.message?.includes('ERROR_API_KEY_LIMIT_REACHED') ||
          err.message?.includes('circuit breaker is active')
        ) {
          menetbrandQuotaExhausted = true;
          if (existingManifest) {
            activeManifests.push({
              manifest: existingManifest,
              displayName: feed.displayName,
              region: feed.region,
            });
            feedResults.push({
              feedId: feed.feedId,
              status: existingManifest.status,
              action: 'RETAINED_LKG',
              message: `MenetBrand API quota exhausted on metadata check (${err.message}). Retaining active LKG.`,
              sizeBytes: existingManifest.sizeBytes,
              sha256: existingManifest.sha256,
            });
          } else {
            feedResults.push({
              feedId: feed.feedId,
              status: feed.publicationStatus,
              action: 'FAILED',
              message: `MenetBrand API quota exhausted on metadata check: ${err.message}`,
            });
          }
          continue;
        }
      }

      if (
        meta &&
        existingManifest &&
        meta.sourceHash &&
        meta.sourceHash === existingManifest.sourceHash
      ) {
        // Source has not changed upstream -> SKIP download, retain LKG
        unchangedCount++;
        activeManifests.push({
          manifest: existingManifest,
          displayName: feed.displayName,
          region: feed.region,
        });
        feedResults.push({
          feedId: feed.feedId,
          status: existingManifest.status,
          action: 'SKIPPED_UNCHANGED',
          message: `Source hash matches existing manifest (${meta.sourceHash.slice(0, 12)}...)`,
          sizeBytes: existingManifest.sizeBytes,
          sha256: existingManifest.sha256,
        });
        continue;
      }

      // 3. Acquire candidate
      let candidateBytes: Buffer;
      let format: 'gtfs_zip' | 'menetbrand_sqlite_v5';
      let candidateSourceHash: string;

      try {
        if (feed.feedId === 'szeged' && options.seededFeedFiles) {
          // Pre-seeded canonical dataset for initial publication
          candidateBytes = createZip(options.seededFeedFiles);
          format = 'gtfs_zip';
          candidateSourceHash = meta?.sourceHash ?? createHash('sha256').update(candidateBytes).digest('hex');
        } else {
          downloadedCount++;
          const candidate = await adapter.acquireCandidate({
            ...feed,
            sourceHash: meta?.sourceHash ?? feed.sourceHash,
          });
          candidateBytes = candidate.bytes;
          format = candidate.format;
          candidateSourceHash = candidate.sourceHash;
        }
      } catch (err: any) {
        if (
          err instanceof QuotaExhaustedError ||
          err.message?.includes('ERROR_API_KEY_LIMIT_REACHED') ||
          err.message?.includes('circuit breaker is active')
        ) {
          menetbrandQuotaExhausted = true;
        }

        // If acquisition fails and it's szeged without an existing manifest, check seed archive
        const seedPath = path.resolve(process.cwd(), 'seed/szeged-canonical-gtfs.zip');
        if (feed.feedId === 'szeged' && !existingManifest && fs.existsSync(seedPath)) {
          console.warn(`⚠️ Szeged live acquisition failed (${err.message}). Falling back to seed canonical dataset.`);
          candidateBytes = fs.readFileSync(seedPath);
          format = 'gtfs_zip';
          candidateSourceHash = createHash('sha256').update(candidateBytes).digest('hex');
        } else if (existingManifest) {
          activeManifests.push({
            manifest: existingManifest,
            displayName: feed.displayName,
            region: feed.region,
          });
          if (feed.feedId === 'szeged' && !isDryRun) {
            const legacyKey = 'menetrend/szeged/manifest.json';
            const legacyHead = await this.storage.headObject(legacyKey);
            if (!legacyHead) {
              const manifestJson = serializeManifest(existingManifest);
              await this.storage.putObject(legacyKey, Buffer.from(manifestJson, 'utf8'), {
                contentType: 'application/json; charset=utf-8',
                cacheControl: 'no-cache, must-revalidate',
              });
            }
          }
          feedResults.push({
            feedId: feed.feedId,
            status: existingManifest.status,
            action: 'RETAINED_LKG',
            message: `Acquisition failed: ${err.message}. Retaining active LKG.`,
            sizeBytes: existingManifest.sizeBytes,
            sha256: existingManifest.sha256,
          });
          continue;
        } else {
          feedResults.push({
            feedId: feed.feedId,
            status: feed.publicationStatus,
            action: 'FAILED',
            message: `Acquisition failed: ${err.message}`,
          });
          continue;
        }
      }

      // 4. GTFS Normalization, Canonicalization, and Validation
      let finalZipBuffer: Buffer;
      let valResult: GtfsValidationResult;
      let canonicalIdentityVersion: number | undefined = undefined;

      if (feed.feedId === 'szeged') {
        let gtfsFiles: Map<string, string>;
        try {
          if (format === 'menetbrand_sqlite_v5') {
            const exported = exportMenetBrandDatabaseToGtfs(candidateBytes);
            gtfsFiles = new Map(Object.entries(exported));
          } else {
            gtfsFiles = readZipEntries(candidateBytes);
          }
        } catch (err: any) {
          rejectedCount++;
          this.recordRejection(feed, existingManifest, activeManifests, feedResults, `Format conversion failed: ${err.message}`);
          continue;
        }

        try {
          const reg = this.canonicalRegistry ?? CanonicalRegistry.loadDefaultSzeged();
          const canonResult = canonicalizeGtfsFiles(gtfsFiles, reg, 'MENETBRAND_SZEGED');
          gtfsFiles = canonResult.files;
          canonicalIdentityVersion = 1;
        } catch (err: any) {
          rejectedCount++;
          this.recordRejection(feed, existingManifest, activeManifests, feedResults, `Canonicalization failed: ${err.message}`);
          continue;
        }

        valResult = validateGtfsPackage(gtfsFiles);
        if (!valResult.isValid) {
          rejectedCount++;
          this.recordRejection(feed, existingManifest, activeManifests, feedResults, `GTFS validation failed: ${valResult.errors.join('; ')}`);
          continue;
        }

        const regressionError = verifySzegedSemanticRegression(gtfsFiles);
        if (regressionError) {
          rejectedCount++;
          this.recordRejection(feed, existingManifest, activeManifests, feedResults, `Szeged semantic canary failed: ${regressionError}`);
          continue;
        }

        finalZipBuffer = createZip(gtfsFiles);
      } else {
        // RAW_MIRROR feeds
        if (format === 'menetbrand_sqlite_v5') {
          try {
            const exported = exportMenetBrandDatabaseToGtfs(candidateBytes);
            const gtfsFiles = new Map(Object.entries(exported));
            valResult = validateGtfsPackage(gtfsFiles);
            finalZipBuffer = createZip(gtfsFiles);
          } catch (err: any) {
            rejectedCount++;
            this.recordRejection(feed, existingManifest, activeManifests, feedResults, `Conversion failed: ${err.message}`);
            continue;
          }
        } else {
          // Standard GTFS ZIP passthrough (e.g. Budapest BKK) - validate directly from buffer
          valResult = validateGtfsPackage(candidateBytes);
          finalZipBuffer = candidateBytes;
        }

        if (!valResult.isValid) {
          rejectedCount++;
          this.recordRejection(feed, existingManifest, activeManifests, feedResults, `GTFS validation failed: ${valResult.errors.join('; ')}`);
          continue;
        }
      }

      // 7. Catastrophe Drop Protection
      const lkgMetrics = existingManifest?.metrics
        ? {
            stopCount: existingManifest.metrics.stops,
            routeCount: existingManifest.metrics.routes,
            tripCount: existingManifest.metrics.trips,
            stopTimeCount: existingManifest.metrics.stopTimes,
            shapeCount: existingManifest.metrics.shapes,
            serviceCount: 0,
            coverageStart: existingManifest.coverageStart,
            coverageEnd: existingManifest.coverageEnd,
            agencyTimeZone: null,
          }
        : null;

      const catastrophe = checkCatastropheDrop(valResult.metrics, lkgMetrics);
      if (catastrophe.isCatastrophe) {
        rejectedCount++;
        this.recordRejection(feed, existingManifest, activeManifests, feedResults, `Catastrophe drop rejected: ${catastrophe.reason}`);
        continue;
      }

      // 9. Atomic Publication to R2
      const contentSha256 = createHash('sha256').update(finalZipBuffer).digest('hex');
      const artifactKey = `v1/feeds/${feed.feedId}/artifacts/${contentSha256}.zip`;

      // 9b. Companion walking asset detection (e.g. Budapest companion)
      let walkingCompanionManifest: import('../catalog/manifest.js').WalkingCompanionManifest | undefined = undefined;
      let companionBuffer: Buffer | null = null;
      let companionArtifactKey: string | null = null;

      const companionSeedPath = path.resolve(process.cwd(), `seed/utirany-${feed.feedId}-transit-walking-v1.bin`);
      if (fs.existsSync(companionSeedPath)) {
        companionBuffer = fs.readFileSync(companionSeedPath);
        const compSha = createHash('sha256').update(companionBuffer).digest('hex');
        companionArtifactKey = `v1/feeds/${feed.feedId}/artifacts/${compSha}.bin`;
        const cleanBase = this.config.publicFeedBaseUrl.replace(/\/+$/, '');
        const fullCompUrl = `${cleanBase}/${companionArtifactKey}`;
        walkingCompanionManifest = {
          downloadUrl: fullCompUrl,
          artifactUrl: fullCompUrl,
          contentSha256: compSha,
          sha256: compSha,
          byteSize: companionBuffer.length,
          sizeBytes: companionBuffer.length,
          schemaVersion: 1,
          physicalStopCount: valResult.metrics.stopCount,
          assetName: `utirany-${feed.feedId}-transit-walking-v1.bin`,
        };
      }

      const manifest = createFeedManifest({
        feedId: feed.feedId,
        city: feed.feedId,
        generation: candidateSourceHash || contentSha256,
        sha256: contentSha256,
        byteSize: finalZipBuffer.length,
        publicBaseUrl: this.config.publicFeedBaseUrl,
        artifactPath: artifactKey,
        metrics: valResult.metrics,
        sourceMetadata: feed.preferredSource,
        status: feed.publicationStatus,
        sourceHash: candidateSourceHash || contentSha256,
        canonicalIdentityVersion,
        walkingCompanion: walkingCompanionManifest,
      });

      if (!isDryRun) {
        // Step 1: Upload immutable artifact
        await this.storage.putObject(artifactKey, finalZipBuffer, {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=31536000, immutable',
        });

        // Step 1b: Upload immutable companion asset if present
        if (companionBuffer && companionArtifactKey) {
          await this.storage.putObject(companionArtifactKey, companionBuffer, {
            contentType: 'application/octet-stream',
            cacheControl: 'public, max-age=31536000, immutable',
          });
          const compHead = await this.storage.headObject(companionArtifactKey);
          if (!compHead || compHead.contentLength !== companionBuffer.length) {
            throw new Error(`R2 companion artifact verification failed for ${companionArtifactKey}`);
          }
        }

        // Step 2: Verify artifact exists on R2
        const head = await this.storage.headObject(artifactKey);
        if (!head || head.contentLength !== finalZipBuffer.length) {
          throw new Error(`R2 artifact verification failed for ${artifactKey}`);
        }

        // Step 3: Upload manifest LAST
        const manifestJson = serializeManifest(manifest);
        await this.storage.putObject(manifestKey, Buffer.from(manifestJson, 'utf8'), {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'no-cache, must-revalidate',
        });

        // For Szeged: write legacy path for backward compatibility
        if (feed.feedId === 'szeged') {
          await this.storage.putObject('menetrend/szeged/manifest.json', Buffer.from(manifestJson, 'utf8'), {
            contentType: 'application/json; charset=utf-8',
            cacheControl: 'no-cache, must-revalidate',
          });
        }

        // Step 4: Apply retention policy
        await cleanFeedHistoricArtifacts(this.storage, feed.feedId, contentSha256, {
          maxHistoricArtifactsPerFeed: 1,
          dryRun: false,
        });
      }

      publishedCount++;
      activeManifests.push({
        manifest,
        displayName: feed.displayName,
        region: feed.region,
      });
      feedResults.push({
        feedId: feed.feedId,
        status: manifest.status,
        action: 'PUBLISHED',
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
      });
    }

    // 10. Update Nationwide Catalog LAST
    const catalog = buildCatalog(activeManifests);
    if (!isDryRun && activeManifests.length > 0) {
      const catalogJson = serializeCatalog(catalog);
      await this.storage.putObject('v1/catalog.json', Buffer.from(catalogJson, 'utf8'), {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-cache, must-revalidate',
      });
    }

    // 11. Storage Accounting
    const allObjects = await this.storage.listObjects('v1/');
    const totalStorageBytes = allObjects.reduce((acc, o) => acc + o.size, 0);

    const endTime = new Date();
    const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;

    const summary: PublisherRunSummary = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds,
      isDryRun,
      feedsDiscoveredCount: feeds.length,
      metadataCheckedCount,
      unchangedCount,
      downloadedCount,
      publishedCount,
      rejectedCount,
      gatedCount,
      menetbrandQuotaExhausted,
      appReadyFeeds: activeManifests.filter((m) => m.manifest.status === 'APP_READY').map((m) => m.manifest.feedId),
      rawMirrorFeeds: activeManifests.filter((m) => m.manifest.status === 'RAW_MIRROR').map((m) => m.manifest.feedId),
      feedResults,
      totalStorageBytes,
      totalStorageObjects: allObjects.length,
    };

    return summary;
  }

  private recordRejection(
    feed: DiscoveredTransitFeed,
    existingManifest: FeedManifest | null,
    activeManifests: Array<{ manifest: FeedManifest; displayName: string; region: string }>,
    feedResults: PublisherRunSummary['feedResults'][number][],
    reason: string,
  ): void {
    if (existingManifest) {
      activeManifests.push({
        manifest: existingManifest,
        displayName: feed.displayName,
        region: feed.region,
      });
      feedResults.push({
        feedId: feed.feedId,
        status: existingManifest.status,
        action: 'RETAINED_LKG',
        message: `${reason}. Active LKG retained.`,
        sizeBytes: existingManifest.sizeBytes,
        sha256: existingManifest.sha256,
      });
    } else {
      feedResults.push({
        feedId: feed.feedId,
        status: feed.publicationStatus,
        action: 'FAILED',
        message: reason,
      });
    }
  }
}

export function verifySzegedSemanticRegression(files: Map<string, string>): string | null {
  const routesText = files.get('routes.txt');
  const tripsText = files.get('trips.txt');
  const stopsText = files.get('stops.txt');

  if (!routesText || !tripsText || !stopsText) {
    return 'Missing routes.txt, trips.txt, or stops.txt';
  }

  // 1. Verify canonical stop IDs prefix
  const stopLines = stopsText.split(/\r?\n/);
  for (let i = 1; i < stopLines.length; i++) {
    const line = stopLines[i].trim();
    if (!line) continue;
    const stopId = line.split(',')[0]?.trim();
    if (!stopId.startsWith('utirany:physical_stop:')) {
      return `Non-canonical stop ID found in Szeged stops.txt: '${stopId}'`;
    }
  }

  // 2. Representative routes check
  const expectedRoutes = ['2', '4', '8', '10', '19', '72', '84', '90', '90H'];
  const routeShortNames = new Set(
    routesText
      .split(/\r?\n/)
      .map((l) => l.split(',')[2]?.trim().replace(/"/g, ''))
      .filter(Boolean),
  );

  for (const exp of expectedRoutes) {
    if (!routeShortNames.has(exp)) {
      return `Representative route '${exp}' missing from Szeged feed`;
    }
  }

  // 3. Post-2026-09-01 90H BYD canary check
  const hasBydInTripsOrStops =
    tripsText.includes('BYD') ||
    stopsText.includes('BYD') ||
    tripsText.includes('utirany:physical_stop:14cf') ||
    stopsText.includes('utirany:physical_stop:14cf');

  if (!hasBydInTripsOrStops) {
    return '90H BYD canary failed: no BYD service or BYD stop detected in feed';
  }

  return null;
}
