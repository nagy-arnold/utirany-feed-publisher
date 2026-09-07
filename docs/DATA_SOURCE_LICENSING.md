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
- **Authority Level:** `OFFICIAL_DIRECT` (Direct Portal) / `VERIFIED_AGGREGATOR` (via MenetBrand `mav_volan`)
- **Direct Official Portal:** Registration required at `https://www.mavcsoport.hu/gtfs-igenybejelento`.
- **Three-Way Modeling Distinction:**
  1. **Acquisition Availability:** Direct official source is `UNCONFIGURED` without credentials (adapter truthfully returns empty list `[]` during discovery); acquisition is available only via aggregator (`mav_volan`).
  2. **Redistribution Permission:** **`UNKNOWN`** / **`PRIVATE_ACQUISITION_ONLY`**. Without direct formal redistribution rights or signed open-data redistribution agreement, nationwide MÁV feeds are blocked from the public R2 bucket by the engine gate.
  3. **Application Readiness:** **`NOT_READY`** (requires nationwide route matching, multi-agency ticketing, and walking connectivity).
- **License:** Public passenger transport schedule data (direct terms non-standardized).
- **Attribution Requirement:** *"Forrás: MÁV-START Zrt. / Volánbusz Zrt."*
- **Policy:** **`PRIVATE_ACQUISITION_ONLY`** / **`UNKNOWN`** (Gated from public R2 publication).

### 4. Regional Municipal Feeds (Debrecen, Pécs, Miskolc, Kecskemét, Tatabánya, etc.)
- **Provider:** MenetBrand regional configurations.
- **Authority Level:** `VERIFIED_AGGREGATOR`
- **Policy:** Audited as **`UNKNOWN`** for public redistribution.
- **Enforced Safety Gate:** Only feeds with explicit public redistribution proof (`budapest` via BKK CC-BY open data, and `szeged` via explicit canonical app contract) are published to the public R2 bucket. All other regional feeds are acquired for validation/compatibility analysis but blocked from public distribution until individual licensing agreements are finalized.
- **Default Policy for Unclassified Feeds:** All newly discovered feeds default strictly to **`UNKNOWN`**.
