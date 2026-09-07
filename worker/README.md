# Cloudflare Worker — utirany-feed

Public HTTPS read-only delivery gateway for Útirány transit timetable feeds.

## Architecture
- **Worker Name:** `utirany-feed`
- **Public URL:** `https://utirany-feed.tir-ny.workers.dev`
- **R2 Binding:** `TRANSIT_FEEDS` → `utirany-transit-feeds` (Private bucket)
- **Access Policy:** Public anonymous HTTPS access (no Cloudflare Access, no API keys required for clients).

## Responsibilities
1. `GET /` — Health check JSON (`{"service":"utirany-feed","status":"ok"}`).
2. `GET /v1/catalog.json` — Reads nationwide feed catalog directly from private R2 bucket.
3. `GET /v1/feeds/<feedId>/manifest.json` — Reads per-feed manifest.
4. `GET /v1/feeds/<feedId>/artifacts/<sha256>.zip` — Content-addressed immutable GTFS ZIP (`Cache-Control: public, max-age=31536000, immutable`).
5. `GET /menetrend/szeged/manifest.json` — Backward-compatibility alias to `v1/feeds/szeged/manifest.json`.
6. ETag & HTTP 304 Not Modified support via `If-None-Match`.
7. Rejects mutation methods (POST, PUT, DELETE) with `405 Method Not Allowed`.

## Deployment
Worker changes are rare and decoupled from daily publication runs.
To deploy updates to Cloudflare:
```bash
cd worker
npx wrangler deploy
```
