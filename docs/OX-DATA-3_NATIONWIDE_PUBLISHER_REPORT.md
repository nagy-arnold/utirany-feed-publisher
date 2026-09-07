# PHASE OX-DATA-3 — Engineering Report: Útirány Nationwide Multi-Source Transit Data Platform

**Date Context:** 2026-09-07  
**Repository:** `https://github.com/nagy-arnold/utirany-feed-publisher`  
**Platform Status:** Operational / Production Ready

---

## 1. Initial Repository State
The repository was initialized from a freshly cloned empty Git repository. Zero files existed initially. All tooling, application modules, source adapters, canonical assets, test suites, Cloudflare Worker source, and CI/CD pipelines were developed from the ground up without runtime dependencies on external paths.

## 2. Platform Architecture
Útirány is architected as a nationwide, multi-source transit data publishing platform. The architecture separates upstream source adapters from downstream validation, canonicalization, packaging, and publication:
- **Upstream Sources:** BKK OpenData (Budapest), MenetBrand (Szeged, regional municipal networks, MÁV-Volán aggregation), MÁV Group.
- **Source Registry:** Decouples the publisher engine from provider-specific formats via `TransitFeedSourceAdapter`.
- **GTFS Engine:** Standardizes SQLite v5 / GTFS ZIP payloads into validated GTFS CSV packages.
- **Canonical Registry:** Enforces stable `utirany:physical_stop:...` identities for Szeged.
- **Storage & Delivery:** Private Cloudflare R2 object storage with public read-only Cloudflare Worker gateway over HTTPS.

## 3. Technology Choice
- **Runtime:** Node.js 22+ (v24.15.0 verified) with native ECMAScript Modules (ESM).
- **TypeScript:** Strict TypeScript 5.8 with NodeNext module resolution.
- **SQLite:** Node.js native `DatabaseSync` (`node:sqlite`) eliminating native compilation issues.
- **Cloudflare R2 Storage:** `@aws-sdk/client-s3` (S3 API compatibility).
- **ZIP Packaging:** `adm-zip` isolated behind `src/gtfs/zip.ts`.
- **Test Runner:** Node native test runner (`node:test`, `node:assert/strict`).

## 4. MenetBrand API Discovery
Audited live contract against `https://api.menetbrand.com/last/swagger/data.json`:
- `GET /hungary/gtfs/config`: 26 regions, 31 build configs, 41 release configs.
- `GET /hungary/gtfs/info`: Fast metadata endpoint providing SHA-256 hash, trip count, coverage dates (`trips_begin`, `trips_end`), and included configurations.
- `GET /hungary/gtfs/download`: SQLite v5 archive download (`type=zip`).

## 5. Feed Discovery Model
`SourceRegistry` discovers feeds across all active adapters:
- Maps upstream identifiers to stable public feed IDs (`szeged`, `budapest`, `mav-volan`, `pecs`, etc.).
- Eliminates hardcoded static city arrays in the core publishing loop.

## 6. Security Model
- Zero credentials committed to git, saved in temporary logs, or output in diagnostics.
- `MENETBRAND_API_KEY`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are read exclusively from environment variables in protected runner environments.
- Public Worker gateway operates without credentials and with no write/delete permissions.

## 7. API Quota Strategy
- MenetBrand enforces a strict daily call budget (HTTP 401 `ERROR_API_KEY_LIMIT_REACHED`).
- The publisher queries metadata (`info` / ETag) before initiating data downloads.
- Unchanged feeds are skipped. Quota errors are classified as `QuotaExhaustedError`, immediately aborting further calls while safely preserving active LKG manifests.

## 8. Stable Public Feed IDs
Feed IDs are deterministic and stable across updates (`szeged`, `budapest`, `mav-volan`, `pecs`, `miskolc`, `kecskemet`, `debrecen`, `kaposvar`, `szombathely`, `tatabanya`, `veszprem`).

## 9. R2 Public Object Layout
```
v1/catalog.json
v1/feeds/<feedId>/manifest.json
v1/feeds/<feedId>/artifacts/<contentSha256>.zip
```
Immutable artifacts are strictly content-addressed; existing files are never overwritten.

## 10. Nationwide Catalog
Published at `v1/catalog.json`. Contains deterministic feed ordering, coverage intervals, updated timestamps, manifest paths, and source authority metadata.

## 11. Feed Manifest Contract
Aligned with the Android application's `RemoteManifestDto` contract:
- Backward-compatible fields: `generationId`, `contentSha256`, `byteSize`, `validFrom`, `validUntil`, `publishedAt`, `downloadUrl`, `city`.
- Modern publisher fields: `feedId`, `generation`, `sha256`, `sizeBytes`, `sourceHash`, `status`, `source`, `canonicalIdentityVersion`, `metrics`.

## 12. GTFS Validation
Deterministic pre-publication validation checks:
- Required files: `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, and calendar data.
- Referential integrity across trips, routes, stop times, and stops.
- Hungary regional coordinate bounding.
- Parseable arrival/departure times including post-midnight service times (>24:00:00).

## 13. Catastrophe Drop Protection
Blocks publication if a candidate exhibits count drops (>80% drop in stops, routes, trips, or stop times vs active LKG) or fails absolute minimum thresholds (<10 stops, <1 route, <1 trip).

## 14. Szeged Canonicalization
Szeged stop identities are rewritten from raw upstream IDs to persistent physical stop IDs (`utirany:physical_stop:...`). Any unmapped stop safely triggers a publication rejection rather than corrupting Android stop mapping.

## 15. Canonical Registry
`src/canonical/szeged-canonical-identity-v1.json` is checked directly into version control in this repository, establishing the publisher as the authoritative central registry.

## 16. First Szeged Publication
Szeged canonical dataset was seeded from the verified canonical assets, validated, checked against catastrophe rules, verified against the 90H BYD canary, and packaged as an `APP_READY` artifact.

## 17. Nationwide Discovery
Discovered 11 active Hungarian transit feeds across BKK, MenetBrand, and MÁV Group.

## 18. RAW_MIRROR Feeds
Budapest (`budapest`), MÁV-Volán (`mav-volan`), Pécs, Miskolc, Debrecen, Kecskemét, Kaposvár, Szombathely, Tatabánya, and Veszprém are validated and maintained as `RAW_MIRROR` feeds.

## 19. APP_READY Feeds
Szeged (`szeged`) is published as `APP_READY`.

## 20. Overlap Analysis
Evaluated in `docs/FEED_OVERLAP_ANALYSIS.md`. Distinct per-feed artifacts prevent mobile bandwidth exhaustion and decouple independent municipal schedule cycles.

## 21. Retention Policy
`src/publisher/retention.ts` retains the active artifact plus one previous LKG version, deleting obsolete historical files to maintain clean storage bounds.

## 22. Atomic Publication
Invariants strictly enforced:
1. Candidate build & validation.
2. Upload immutable ZIP artifact.
3. Verify uploaded object via `headObject`.
4. Upload manifest LAST.
5. Update catalog LAST.

## 23. GitHub Actions Automation
Workflow `.github/workflows/publish.yml` provides:
- Single-concurrency execution (`concurrency: { group: 'feed-publisher', cancel-in-progress: false }`).
- Daily scheduled execution (03:15 UTC / 05:15 CEST).
- Manual trigger via `workflow_dispatch` (with optional `feed` filter and `dry_run` flag).
- Automated Markdown Step Summary.

## 24. Cloudflare Worker Source Control
`worker/src/index.ts` provides a read-only HTTPS gateway directly to R2:
- Supports `GET` and `HEAD`.
- Root health JSON.
- ETag propagation and conditional `304 Not Modified` via `If-None-Match`.
- Immutable ZIP caching (`Cache-Control: public, max-age=31536000, immutable`).
- Backward-compatibility alias: `/menetrend/szeged/manifest.json`.

## 25. Live Cloudflare Verification
Worker endpoints verified live:
- `GET /` -> 200 OK (`{"service":"utirany-feed","status":"ok"}`)
- `GET /v1/catalog.json` -> 200 OK
- `GET /v1/feeds/szeged/manifest.json` -> 200 OK
- `HEAD /v1/feeds/szeged/artifacts/<sha256>.zip` -> 200 OK
- Byte-exact SHA-256 match confirmed.
- `If-None-Match` -> 304 Not Modified confirmed.

## 26. Automated Test Suite
35 automated tests in `tests/`:
- `config.test.ts`
- `source-registry.test.ts`
- `bkk-adapter.test.ts`
- `menetbrand.test.ts`
- `gtfs-validation.test.ts`
- `catastrophe.test.ts`
- `canonicalize.test.ts`
- `catalog-manifest.test.ts`
- `atomicity.test.ts`
- `retention.test.ts`
- `szeged-regression.test.ts`
- `worker.test.ts`

## 27. Actions Runtime
- Local test suite: ~1.5s
- Single feed dry-run (Szeged): ~9s
- Single feed dry-run (Budapest): ~99s
- Typical GitHub Actions scheduled job runtime: ~2–3 minutes.

## 28. Storage Accounting
- Szeged artifact: ~4.8 MB
- Budapest artifact: ~46 MB
- MÁV-Volán artifact: ~55 MB
- Combined active + 1 previous LKG per feed fits comfortably inside <250 MB total R2 storage (well below Cloudflare's 10 GB free tier).

## 29. Cost Expectations
- Cloudflare R2: 10 GB storage free; Class A operations (writes) 1M/month free; Class B operations (reads) 10M/month free.
- Cloudflare Worker: 100,000 requests/day free.
- Total operating cost: **$0.00 / month (100% Free Tier)**.

## 30. Android Integration Details
- **Base URL:** `https://utirany-feed.tir-ny.workers.dev`
- **Szeged Manifest Path:** `/v1/feeds/szeged/manifest.json` (or `/menetrend/szeged/manifest.json`)
- **Manifest Schema:** Version 1 (compatible with existing Android `RemoteManifestDto`).

## 31. Known Product Limitations
- **Walking Asset Connectivity for New Stops:** If an upstream update introduces a brand new physical stop, existing walking connection binaries will not connect to it until walking assets are regenerated.

## 32. Recommended Next Steps
- Implement remote walking asset bundle publishing in a future phase.
- Expand canonical stop identity reconciliation to Budapest and MÁV-Volán networks.
