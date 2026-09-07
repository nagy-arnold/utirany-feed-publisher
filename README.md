# Útirány Nationwide Multi-Source Transit Data Platform

> Autonomous timetable feed publishing platform for the nationwide Hungarian Útirány public transport system.

[![Publish Nationwide Transit Feeds](https://github.com/nagy-arnold/utirany-feed-publisher/actions/workflows/publish.yml/badge.svg)](https://github.com/nagy-arnold/utirany-feed-publisher/actions/workflows/publish.yml)

---

## 1. System Architecture

```
                                  UPSTREAM SOURCES
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
    BKK OpenData                    MenetBrand                      MÁV-START
   (Budapest Direct)           (Szeged & Aggregations)          (Nationwide Rail)
         │                               │                               │
         └───────────────────────┬───────┴───────────────────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │ Source Registry &     │
                     │ Generic Adapters      │
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ GTFS Normalization    │
                     │ & Validation Engine   │
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ Canonical Identity    │
                     │ Reconciliation        │
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ Cloudflare R2 Bucket  │ (Private Object Storage)
                     │ utirany-transit-feeds │
                     └───────────┬───────────┘
                                 │ Private R2 Binding
                                 ▼
                     ┌───────────────────────┐
                     │  Cloudflare Worker    │ https://utirany-feed.tir-ny.workers.dev
                     │    (utirany-feed)     │ (Public Read-Only HTTPS Gateway)
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ Útirány Android App   │
                     │ (Anonymous HTTPS)     │
                     └───────────────────────┘
```

---

## 2. Key Features

- **Multi-Source Ingestion:** Independent `TransitFeedSourceAdapter` implementations for official direct sources (BKK), verified aggregators (MenetBrand), and national operators (MÁV).
- **Szeged Canonical Identity Contract:** Reconciles upstream stop identities with the persistent canonical registry (`utirany:physical_stop:...`) for Android app compatibility.
- **Semantic Canaries & Catastrophe Protection:** Rejects corrupted exports, missing routes, and catastrophe count drops (>80% decrease vs active LKG). Validates the post-2026-09-01 90H BYD route and SZKT tram/trolley lines.
- **Atomic Cloudflare R2 Publication:** Immutable content-addressed artifacts (`/v1/feeds/<feedId>/artifacts/<sha256>.zip`) uploaded first, verified via `headObject`, followed by manifests and the nationwide catalog (`/v1/catalog.json`).
- **Strict Security Model:** Zero credentials in public delivery. All secrets (`MENETBRAND_API_KEY`, R2 access keys) remain strictly in server-side execution environments.
- **Code-Enforced Licensing Gates:** Non-public/unknown data sources are blocked from public mirroring.

---

## 3. Local Developer Commands

```bash
# Install dependencies
npm ci

# Run all test suites
npm test

# Typecheck source code
npm run typecheck

# Discover available nationwide feeds
npm run discover

# Dry run sync (validates feeds in memory with zero R2 writes)
npm run sync -- --dry-run

# Sync specific feed in dry-run mode
npm run sync -- --dry-run --feed szeged
npm run sync -- --dry-run --feed budapest

# Validate arbitrary GTFS package
npm run validate path/to/gtfs.zip
```

---

## 4. GitHub Actions Automation

- Workflow file: `.github/workflows/publish.yml`
- Scheduled daily run at `15 3 * * *` (03:15 UTC / 05:15 Europe/Budapest CEST).
- Supports manual `workflow_dispatch` with optional `feed` filter and `dry_run` flag.
- Single-concurrency execution: prevents overlapping publisher jobs.
- Automatic Step Summary with storage accounting and feed status.

---

## 5. Documentation Directory

- [`docs/DATA_SOURCE_LICENSING.md`](docs/DATA_SOURCE_LICENSING.md) — Source licensing audit & redistribution gates.
- [`docs/PUBLIC_FEED_CONTRACT.md`](docs/PUBLIC_FEED_CONTRACT.md) — Catalog & manifest v1 JSON schemas, caching, and walking constraints.
- [`docs/MENETBRAND_DISCOVERY.md`](docs/MENETBRAND_DISCOVERY.md) — OpenAPI 3.0 audit, endpoints, and quota behavior.
- [`docs/FEED_OVERLAP_ANALYSIS.md`](docs/FEED_OVERLAP_ANALYSIS.md) — Dataset overlaps and modular archive strategy.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Incident response, rollback, and credential rotation runbooks.
- [`docs/OX-DATA-3_NATIONWIDE_PUBLISHER_REPORT.md`](docs/OX-DATA-3_NATIONWIDE_PUBLISHER_REPORT.md) — Full milestone engineering report.
