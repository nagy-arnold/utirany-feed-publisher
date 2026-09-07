# Feed Overlap Analysis & Nationwide Artifact Strategy

This document evaluates dataset overlaps between nationwide, regional, and municipal transit feeds in Hungary, and outlines why Útirány publishes separate, dedicated feed artifacts rather than a single monolithic national GTFS archive.

---

## 1. Upstream Overlap Patterns

In MenetBrand's release configuration catalog, several layers of overlap exist:

1. **Nationwide Umbrella Configs (`hungary`, `hungary_max`, `mav_volan`)**:
   - `mav_volan`: Merges nationwide rail (`mav`) and nationwide interurban bus (`volanbusz`).
   - `hungary`: Merges rail, Volánbusz, and 20+ municipal networks (BKK Budapest, SZKT Szeged, DKV Debrecen, etc.).
2. **Regional/Municipal Configs (`szeged`, `budapest`, `pecs`, `miskolc`, etc.)**:
   - `szeged`: Merges local city transit (`szeged`, `szeged_ex`), regional tram-train (`hodmezovasarhely`), and local regional rail/bus segments (`mav_szeged`, `volanbusz_szeged`).
   - `budapest`: Merges BKK municipal bus/tram/metro/trolley with suburban rail (`mav_budapest`) and suburban Volánbusz (`volanbusz_budapest`).

---

## 2. Why Monolithic "One Hungary ZIP" is Rejected

Publishing a single monolithic Hungarian GTFS ZIP has major product, performance, and operational drawbacks:

1. **Massive Download Size on Mobile:**
   - A combined nationwide feed exceeds 150+ MB compressed (~800 MB uncompressed CSVs, 10M+ stop_times).
   - Forcing mobile users in Szeged or Budapest to download the entire country's timetable daily exhausts mobile data and storage.
2. **Independent City Release Cycles:**
   - Municipal networks update schedules at different times (e.g. BKK changes monthly/bi-weekly; SZKT changes seasonally; MÁV changes annually with seasonal adjustments).
   - An update to a local bus in Nyíregyháza would force re-downloading Budapest and Szeged for all users.
3. **Canonical Identity Isolation:**
   - Szeged is currently the only city with fully canonicalized physical stop identities (`utirany:physical_stop:...`) integrated into Android routing and walking graphs.
   - Merging uncanonicalized nationwide stops into the same package would break the Android app's strict canonical assumptions.
4. **Cloudflare Worker & R2 Limits:**
   - Delivering modular, regional 5-45 MB ZIP archives is fast, cache-efficient, and easily fits within standard CDN and mobile constraints.

---

## 3. Modular Multi-Feed Architecture

Útirány publishes distinct, content-addressed feed packages under structured R2 namespaces:
- `/v1/feeds/szeged/artifacts/<hash>.zip` (~4.8 MB, APP_READY)
- `/v1/feeds/budapest/artifacts/<hash>.zip` (~46 MB, RAW_MIRROR)
- `/v1/feeds/mav-volan/artifacts/<hash>.zip` (~55 MB, RAW_MIRROR)
- `/v1/feeds/<feedId>/artifacts/<hash>.zip` (regional feeds)

The nationwide catalog (`v1/catalog.json`) enumerates all available feeds with status, coverage, and manifest URLs.
Future Android app iterations will selectively activate the feeds required for the user's active region or nationwide intercity journey.
