# Public Transit Feed Contract (v1)

This specification defines the public HTTP contract exposed by the Útirány Feed Publisher via the Cloudflare Worker gateway at `https://utirany-feed.tir-ny.workers.dev`.

---

## 1. HTTP Endpoints

| Method | Path | Description | Cache-Control |
|---|---|---|---|
| `GET`, `HEAD` | `/` | Service health status | `no-store` |
| `GET`, `HEAD` | `/v1/catalog.json` | Nationwide feed catalog | `no-cache, must-revalidate` |
| `GET`, `HEAD` | `/v1/feeds/<feedId>/manifest.json` | Per-feed manifest | `no-cache, must-revalidate` |
| `GET`, `HEAD` | `/v1/feeds/<feedId>/artifacts/<sha256>.zip` | Content-addressed immutable GTFS package | `public, max-age=31536000, immutable` |
| `GET`, `HEAD` | `/menetrend/szeged/manifest.json` | Backward-compatibility alias for Android app | `no-cache, must-revalidate` |

---

## 2. Nationwide Catalog Schema (`v1/catalog.json`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-07T12:00:00.000Z",
  "feeds": [
    {
      "id": "szeged",
      "displayName": "Szeged",
      "status": "APP_READY",
      "region": "Dél-Alföld",
      "coverageStart": "2026-09-01",
      "coverageEnd": "2026-10-31",
      "manifest": "/v1/feeds/szeged/manifest.json",
      "updatedAt": "2026-09-07T05:46:49.000Z",
      "sizeBytes": 5046272,
      "source": {
        "provider": "MenetBrand",
        "authorityLevel": "VERIFIED_AGGREGATOR",
        "license": "MenetBrand Partner Data",
        "attribution": "MenetBrand (menetbrand.com)"
      }
    },
    {
      "id": "budapest",
      "displayName": "Budapest",
      "status": "RAW_MIRROR",
      "region": "Közép-Magyarország",
      "coverageStart": "2026-09-01",
      "coverageEnd": "2026-09-30",
      "manifest": "/v1/feeds/budapest/manifest.json",
      "updatedAt": "2026-09-06T22:02:30.000Z",
      "sizeBytes": 48312320,
      "source": {
        "provider": "BKK Budapesti Közlekedési Központ",
        "authorityLevel": "OFFICIAL_DIRECT",
        "license": "BKK Open Data / CC-BY",
        "attribution": "BKK Budapesti Közlekedési Központ (bkk.hu)"
      }
    }
  ]
}
```

---

## 3. Feed Manifest Schema (`v1/feeds/<feedId>/manifest.json`)

Fulfills both the Android `RemoteManifestDto` contract and modern multi-source publisher metadata:

```json
{
  "schemaVersion": 1,
  "feedId": "szeged",
  "city": "szeged",
  "generationId": "71C152DE4D98D16519CD3FDF48803F328C74A35DFAD2B67479586BE31DC477BE",
  "generation": "71C152DE4D98D16519CD3FDF48803F328C74A35DFAD2B67479586BE31DC477BE",
  "contentSha256": "4b68e916a241...",
  "sha256": "4b68e916a241...",
  "byteSize": 5046272,
  "sizeBytes": 5046272,
  "validFrom": "2026-09-01",
  "validUntil": "2026-10-31",
  "coverageStart": "2026-09-01",
  "coverageEnd": "2026-10-31",
  "publishedAt": "2026-09-07T05:46:49.000Z",
  "downloadUrl": "https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/artifacts/4b68e916a241....zip",
  "artifactUrl": "https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/artifacts/4b68e916a241....zip",
  "sourceHash": "71C152DE4D98D16519CD3FDF48803F328C74A35DFAD2B67479586BE31DC477BE",
  "status": "APP_READY",
  "source": {
    "provider": "MenetBrand",
    "authorityLevel": "VERIFIED_AGGREGATOR",
    "license": "MenetBrand Partner Data",
    "attribution": "MenetBrand (menetbrand.com)"
  },
  "canonicalIdentityVersion": 1,
  "metrics": {
    "stops": 4160,
    "routes": 45,
    "trips": 9542,
    "stopTimes": 268420,
    "shapes": 182
  }
}
```

---

## 4. Feed Publication Status

- **`APP_READY`**:
  - Full canonical stop identity reconciliation applied.
  - Passes semantic regression test suite (e.g. Szeged SZKT 2, 4, 8, 10, 19, bus 72, 84, 90, 90H + post-2026-09-01 90H BYD canary).
  - Compatible with current Android Room importer, routing engine, and search index.
- **`RAW_MIRROR`**:
  - Valid GTFS archive acquired from official/verified upstream source.
  - Structurally validated (integrity, foreign keys, coordinates, times).
  - Retained safely for nationwide archiving and upcoming app integration.

---

## 5. Known Limitation: Szeged Walking Asset Connectivity

The current Android client updates transit timetable schedules into Room via `RemoteTimetableUpdateSource`. Walking connectors (`utirany-szeged-transit-walking-v1.bin`) reside as precomputed assets in the APK, keyed by canonical stop IDs (`utirany:physical_stop:...`).

**Constraint:**
- Because the publisher preserves canonical stop IDs across updates, all ~1,201 existing transit stops retain valid walking connections.
- If an upstream timetable generation introduces a **brand new physical stop**, that new stop will exist in the timetable and appear on maps, but will **lack precalculated pedestrian footpath connections** to neighboring street vertices until walking assets are regenerated.
- **Required Follow-up:** Future Android update contracts should support publishing versioned walking connection binary artifacts alongside canonical GTFS packages.
