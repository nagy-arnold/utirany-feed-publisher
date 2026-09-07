# MenetBrand API Discovery & Contract Audit

This document describes the live structure, endpoints, parameters, format behavior, and quota protection mechanisms of the MenetBrand API (Version 3.0 / 3.1).

> [!CAUTION]
> **Zero Credential Exposure**: Never include the actual `MENETBRAND_API_KEY` in documentation, committed files, logs, or public diagnostics.

---

## 1. API Architecture & Swagger Contract

- **Base URL:** `https://api.menetbrand.com/`
- **Swagger Documentation:** `https://api.menetbrand.com/last/swagger/`
- **OpenAPI 3.0 Specification:** `https://api.menetbrand.com/last/swagger/data.json`
- **Required HTTP Header:** `Service-Version: 3.0.0`
- **Authentication Method:**
  - Standard: HTTP Basic Authentication (`Authorization: Basic <base64(apiKey)>`).
  - Query parameter fallback: `?api_key=<apiKey>`.
  - **Preferred:** Basic auth in HTTP headers avoids placing credentials in URL access logs.

---

## 2. Endpoints

### 2.1 Configuration Discovery: `GET /hungary/gtfs/config`
Retrieves all available transport configurations across Hungary.
- **Parameters:** None.
- **Response Structure:**
  - `route_types`: Standard transit vehicle types (tram `901`, trolley `800`, rail `100`/`102`, bus `704`).
  - `regions`: Geographically bounded areas (26 regions, e.g. `szeged`, `budapest`, `balaton`).
  - `build_configs`: Upstream raw provider feeds (31 configurations, e.g. `szeged`, `mav`, `volanbusz`).
  - `release_configs`: Merged consumer configurations (41 configurations, e.g. `szeged`, `budapest`, `mav_volan`, `hungary`, `hungary_max`).
  - `timetable_config`: Period trimming settings (`trim_to_days: [10, 30, 180]`).

### 2.2 Feed Metadata: `GET /hungary/gtfs/info`
Inspects feed generation metadata and hash without downloading large data files.
- **Parameters:**
  - `config_id` (required): Configuration identifier (e.g. `szeged`, `mav_volan`, `pecs`).
  - `timetable_period` (optional): "5", "10", "30", "60", "__max" (default: "__max").
- **Key Response Fields:**
  - `hash` or `checksum`: SHA-256 fingerprint of the dataset.
  - `trips_begin`: Valid from date (`YYYYMMDD` or ISO).
  - `trips_end`: Valid until date (`YYYYMMDD` or ISO).
  - `created`: Generation timestamp ISO 8601 string.
  - `trips_count`: Total trip count in dataset.
  - `db_version`: SQLite schema version (currently `5`).
  - `included_configs`: Array of merged build configurations.

### 2.3 Feed Download: `GET /hungary/gtfs/download`
Downloads the timetable data archive.
- **Parameters:**
  - `config_id` (required): Configuration identifier.
  - `type` (required): Format option ("db", "zip", "7z").
  - `timetable_period` (optional): "10", "30", "180", "__max".
- **Format Behavior:**
  - `type=zip`: Returns a compressed archive containing the MenetBrand v5 SQLite database (`gtfs.db`).
  - Size: Zipped SQLite database ranges from ~2.4 MB (Szeged) to ~50 MB (Nationwide).
  - The SQLite database contains normalized tables: `agency`, `route`, `stop`, `stop_info`, `trip`, `stop_set_full`, `trip_delta_times`, `calendar_date_range`, `calendar_date`, `shape_compat`.

---

## 3. Quota & Rate Limiting Behavior

MenetBrand enforces a strict daily call quota on API keys.
- **Quota Exhaustion Response:**
  - HTTP Status: `401 Unauthorized`
  - Response Body:
    ```json
    {
      "result": "failure",
      "error_info": "ERROR_API_KEY_LIMIT_REACHED",
      "error_details": "Please contact us at https://gtfs.menetbrand.com/ or see latest swagger at https://api.menetbrand.com/last/swagger/"
    }
    ```
- **Publisher Mitigation Strategy:**
  1. **Metadata-First Change Detection:** Always check `info` or compare source hashes before initiating any download.
  2. **Unchanged Feeds Skipped:** If the upstream source hash matches the active R2 manifest, the download is skipped entirely.
  3. **No Retry Spam:** When `ERROR_API_KEY_LIMIT_REACHED` is encountered, the client classifies it as `QuotaExhaustedError` and aborts further calls immediately.
  4. **Preserve LKG:** Existing published feeds and manifests are never modified or degraded during a quota exhaustion event.
