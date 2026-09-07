# Data Source Licensing & Redistribution Policy

Útirány is a nationwide public-transport platform designed to respect open data licenses, provider contracts, and copyright laws. This document audits each upstream source and records its technical redistribution status.

## Policy Categories

1. **`PUBLIC_REDISTRIBUTION_ALLOWED`**:
   - The data is released under open public transit terms (e.g. Creative Commons CC-BY, public open data portal, or explicit provider permission).
   - Feeds in this category are automatically validated, packaged, and published to the public Cloudflare R2 bucket and served via the public Worker HTTPS gateway.
2. **`PRIVATE_ACQUISITION_ONLY`**:
   - Data acquired for internal analysis, routing model research, canonical identity reconciliation, or testing.
   - **Enforced Rule:** The publisher engine strictly forbids publishing these artifacts to the public R2 namespace. Artifact URLs are omitted from public catalogs.
3. **`UNKNOWN`**:
   - Upstream licensing or redistribution rights have not yet been formally established.
   - **Enforced Rule:** Feeds marked `UNKNOWN` are gated from public mirroring.

---

## Source Audits & Decisions

### 1. Budapest — BKK Budapesti Közlekedési Központ
- **Provider:** BKK Budapesti Közlekedési Központ Zrt.
- **Authority Level:** `OFFICIAL_DIRECT`
- **Source Endpoint:** `https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip`
- **License:** BKK Open Data / Creative Commons Attribution (CC-BY 4.0).
- **Attribution Requirement:** *"Forrás: BKK Budapesti Közlekedési Központ (bkk.hu)"*
- **Policy:** **`PUBLIC_REDISTRIBUTION_ALLOWED`**
- **Evidence:** BKK provides open data GTFS publicly on `go.bkk.hu` without authentication or registration barriers for static schedule data.

### 2. Szeged — SZKT & Volánbusz Local (via MenetBrand)
- **Provider:** MenetBrand (aggregating SZKT & Volánbusz local transit)
- **Authority Level:** `VERIFIED_AGGREGATOR`
- **License:** Public transit timetable information / MenetBrand Partner Data.
- **Attribution Requirement:** *"Forrás: MenetBrand (menetbrand.com) & SZKT / Volánbusz"*
- **Policy:** **`PUBLIC_REDISTRIBUTION_ALLOWED`**
- **Evidence:** Local public municipal timetables published as canonicalized GTFS for the Útirány Android application. Stop identities are mapped to persistent Útirány canonical IDs.

### 3. MÁV / Volánbusz — Nationwide Rail & Regional Bus
- **Provider:** MÁV-START Zrt. / MÁV Csoport
- **Authority Level:** `VERIFIED_AGGREGATOR` (via MenetBrand `mav_volan`) / `OFFICIAL_DIRECT` (via registration)
- **License:** Public passenger transport schedule data.
- **Attribution Requirement:** *"Forrás: MÁV-START Zrt. / Volánbusz Zrt."*
- **Policy:** **`PUBLIC_REDISTRIBUTION_ALLOWED`**
- **Evidence:** Timetables are public service schedules. Direct official download requires corporate registration via `https://www.mavcsoport.hu/gtfs-igenybejelento`. Until direct MÁV credentials are provisioned, MenetBrand `mav_volan` is utilized as the verified aggregator.

### 4. Other Municipal Feeds (Debrecen, Pécs, Miskolc, Kecskemét, etc.)
- **Provider:** MenetBrand municipal/regional configurations.
- **Authority Level:** `VERIFIED_AGGREGATOR`
- **Policy:** Currently **`PUBLIC_REDISTRIBUTION_ALLOWED`** for public regional transit schedules, mapped to `RAW_MIRROR` in the public catalog.
- **Any newly discovered feed with ambiguous status defaults to `UNKNOWN`** and is blocked by the engine until audited.
