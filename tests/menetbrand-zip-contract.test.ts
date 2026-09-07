import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { loadConfig } from '../src/config/env.js';
import { exportMenetBrandDatabaseToGtfs } from '../src/gtfs/export.js';
import { validateGtfsPackage } from '../src/gtfs/validator.js';
import { PublisherEngine } from '../src/publisher/engine.js';
import { MemoryR2Storage } from '../src/r2/memory.js';
import { extractMenetBrandDatabase, validateMenetBrandDatabaseSchema } from '../src/sources/menetbrand/extract.js';
import { SourceRegistry } from '../src/sources/registry.js';
import { AcquiredCandidate, DiscoveredTransitFeed, TransitFeedSourceAdapter } from '../src/sources/types.js';

export function createMenetBrandV5ZipFixture(): { zipBuffer: Buffer; rawDbBuffer: Buffer } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-test-'));
  const dbPath = path.join(tmpDir, 'gtfs.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE app_meta (key TEXT, value TEXT);
      CREATE TABLE agency (id INTEGER PRIMARY KEY, name TEXT, url TEXT, timezone TEXT, lang TEXT, phone TEXT);
      CREATE TABLE calendar_date (service_id TEXT, date INTEGER, exception_type INTEGER);
      CREATE TABLE calendar_date_range (service_id TEXT, date_from INTEGER, date_to INTEGER);
      CREATE TABLE direction (route_key INTEGER, stop_set_id INTEGER, direction_id INTEGER, stops_by INTEGER);
      CREATE TABLE route (key INTEGER PRIMARY KEY, id TEXT, agency_id INTEGER, short_name TEXT, long_name TEXT, type_vehicle INTEGER, color TEXT, text_color TEXT);
      CREATE TABLE route_type_info (id INTEGER, extended_id INTEGER);
      CREATE TABLE shape_compat (shape_id INTEGER, polyline TEXT);
      CREATE TABLE stop (key INTEGER PRIMARY KEY, id TEXT, latitude REAL, longitude REAL, info_id INTEGER, group_id INTEGER);
      CREATE TABLE stop_group (id INTEGER, center_latitude REAL, center_longitude REAL);
      CREATE TABLE stop_info (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE stop_set (id INTEGER, stop_key INTEGER, sequence INTEGER);
      CREATE TABLE trip_delta_times (id INTEGER, stop_sequence INTEGER, arr_elapsed_by_initial INTEGER, dep_elapsed_by_initial INTEGER);
      CREATE TABLE trip_initial_times (id INTEGER PRIMARY KEY, initial_time TEXT);
      CREATE TABLE trip_headsigns (id INTEGER PRIMARY KEY, headsign TEXT);
      CREATE TABLE trip (
        id TEXT PRIMARY KEY, route_key INTEGER, stop_set_id INTEGER, service_id TEXT,
        initial_arr_time_id INTEGER, initial_dep_time_id INTEGER,
        delta_time_id INTEGER, shape_id INTEGER, headsign_id INTEGER
      );
      CREATE VIEW stop_set_full AS
        SELECT direction.route_key, direction.stop_set_id AS id, stop_set.stop_key, stop_set.sequence
        FROM direction JOIN stop_set ON stop_set.id = direction.stops_by;

      INSERT INTO app_meta VALUES ('db_version', '5'), ('created_date_time', '2026-09-07T12:00:00+02:00');
      INSERT INTO agency VALUES (1, 'Tatabánya Helyi Járat', 'https://vbusz.hu', 'Europe/Budapest', 'hu', '+3634123456');
      INSERT INTO route VALUES (1, 'TB_1', 1, '1', 'Autóbusz-állomás - Felsőgalla', 3, '003399', 'FFFFFF');
      INSERT INTO route_type_info VALUES (3, 704);
      INSERT INTO stop_group VALUES (1, 47.568, 18.397);
      INSERT INTO stop_info VALUES (1, 'Autóbusz-állomás');
      INSERT INTO stop_info VALUES (2, 'Felsőgalla vasútállomás');
      INSERT INTO stop_info VALUES (3, 'Stop 3');
      INSERT INTO stop_info VALUES (4, 'Stop 4');
      INSERT INTO stop_info VALUES (5, 'Stop 5');
      INSERT INTO stop_info VALUES (6, 'Stop 6');
      INSERT INTO stop_info VALUES (7, 'Stop 7');
      INSERT INTO stop_info VALUES (8, 'Stop 8');
      INSERT INTO stop_info VALUES (9, 'Stop 9');
      INSERT INTO stop_info VALUES (10, 'Stop 10');
      INSERT INTO stop VALUES (1, 'TB_STOP_1', 47.5681, 18.3972, 1, 1);
      INSERT INTO stop VALUES (2, 'TB_STOP_2', 47.5752, 18.4231, 2, 1);
      INSERT INTO stop VALUES (3, 'TB_STOP_3', 47.5753, 18.4232, 3, 1);
      INSERT INTO stop VALUES (4, 'TB_STOP_4', 47.5754, 18.4233, 4, 1);
      INSERT INTO stop VALUES (5, 'TB_STOP_5', 47.5755, 18.4234, 5, 1);
      INSERT INTO stop VALUES (6, 'TB_STOP_6', 47.5756, 18.4235, 6, 1);
      INSERT INTO stop VALUES (7, 'TB_STOP_7', 47.5757, 18.4236, 7, 1);
      INSERT INTO stop VALUES (8, 'TB_STOP_8', 47.5758, 18.4237, 8, 1);
      INSERT INTO stop VALUES (9, 'TB_STOP_9', 47.5759, 18.4238, 9, 1);
      INSERT INTO stop VALUES (10, 'TB_STOP_10', 47.5760, 18.4239, 10, 1);
      INSERT INTO stop_set VALUES (10, 1, 1);
      INSERT INTO stop_set VALUES (10, 2, 2);
      INSERT INTO direction VALUES (1, 100, 0, 10);
      INSERT INTO trip_initial_times VALUES (1, '06:30:00');
      INSERT INTO trip_initial_times VALUES (2, '06:30:30');
      INSERT INTO trip_delta_times VALUES (1, 1, 0, 0);
      INSERT INTO trip_delta_times VALUES (1, 2, 600, 600);
      INSERT INTO trip_headsigns VALUES (1, 'Felsőgalla');
      INSERT INTO calendar_date_range VALUES ('service_workday', 20260901, 20261031);
      INSERT INTO calendar_date VALUES ('service_workday', 20260901, 1);
      INSERT INTO shape_compat VALUES (1, '_p~iF~ps|U_ulLnnqC_mqNvxq@');
      INSERT INTO trip VALUES ('TRIP_1', 1, 100, 'service_workday', 1, 2, 1, 1, 1);
    `);
  } finally {
    db.close();
  }

  const rawDbBuffer = fs.readFileSync(dbPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const zip = new AdmZip();
  zip.addFile('gtfs.db', rawDbBuffer);
  return { zipBuffer: zip.toBuffer(), rawDbBuffer };
}

test('MenetBrand ZIP contract: safely extracts gtfs.db and validates SQLite signature', () => {
  const { zipBuffer, rawDbBuffer } = createMenetBrandV5ZipFixture();

  // Test 1: extract from ZIP archive
  const extracted = extractMenetBrandDatabase(zipBuffer);
  assert.equal(extracted.sourceType, 'zip_archive');
  assert.equal(extracted.entryName, 'gtfs.db');
  assert.ok(extracted.databaseBuffer.equals(rawDbBuffer));

  // Test 2: raw SQLite passthrough
  const rawExtracted = extractMenetBrandDatabase(rawDbBuffer);
  assert.equal(rawExtracted.sourceType, 'raw_sqlite');
  assert.ok(rawExtracted.databaseBuffer.equals(rawDbBuffer));

  // Test 3: rejects corrupted ZIP or non-sqlite
  const badZip = new AdmZip();
  badZip.addFile('random.txt', Buffer.from('not a db'));
  assert.throws(
    () => extractMenetBrandDatabase(badZip.toBuffer()),
    /does not contain gtfs\.db/,
  );
});

test('MenetBrand ZIP contract: validates SQLite v5 schema contract', () => {
  const { rawDbBuffer } = createMenetBrandV5ZipFixture();
  const validation = validateMenetBrandDatabaseSchema(rawDbBuffer);
  assert.equal(validation.isValid, true);
  assert.equal(validation.dbVersion, 5);
  assert.equal(validation.issues.length, 0);
});

test('MenetBrand end-to-end update: ZIP -> extraction -> SQLite v5 -> GTFS export -> validation -> R2 publish', async () => {
  const { zipBuffer } = createMenetBrandV5ZipFixture();

  // Step 1: Extraction & schema verification
  const extracted = extractMenetBrandDatabase(zipBuffer);
  const schema = validateMenetBrandDatabaseSchema(extracted.databaseBuffer);
  assert.equal(schema.isValid, true);

  // Step 2: GTFS CSV export
  const gtfs = exportMenetBrandDatabaseToGtfs(extracted.databaseBuffer);
  assert.ok(gtfs['agency.txt'].includes('Tatabánya Helyi Járat'));
  assert.ok(gtfs['stops.txt'].includes('TB_STOP_1'));
  assert.ok(gtfs['routes.txt'].includes('TB_1'));
  assert.ok(gtfs['trips.txt'].includes('TRIP_1'));
  assert.ok(gtfs['stop_times.txt'].includes('06:30:00'));

  // Step 3: Full GTFS package validation
  const valResult = validateGtfsPackage(gtfs);
  assert.equal(valResult.isValid, true);
  assert.equal(valResult.metrics.stopCount, 10);
  assert.equal(valResult.metrics.routeCount, 1);
  assert.equal(valResult.metrics.tripCount, 1);
  assert.equal(valResult.metrics.stopTimeCount, 2);
  assert.equal(valResult.metrics.shapeCount, 1);

  // Step 4: Pipeline execution via PublisherEngine
  const storage = new MemoryR2Storage();
  const testAdapter: TransitFeedSourceAdapter = {
    name: 'menetbrand_mock',
    discoverFeeds: async () => [
      {
        feedId: 'tatabanya-test',
        displayName: 'Tatabánya Test',
        region: 'Közép-Dunántúl',
        preferredSource: {
          provider: 'MenetBrand',
          authorityLevel: 'VERIFIED_AGGREGATOR',
          license: 'Test License',
          attribution: 'MenetBrand',
          redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED', // allowed for test
          priority: 10,
        },
        allSources: [],
        sourceHash: 'tb-test-hash-v1',
        format: 'menetbrand_sqlite_v5',
        publicationStatus: 'RAW_MIRROR',
      },
    ],
    fetchMetadata: async () => ({
      sourceHash: 'tb-test-hash-v1',
      coverageStart: '2026-09-01',
      coverageEnd: '2026-10-31',
    }),
    acquireCandidate: async () => ({
      feedId: 'tatabanya-test',
      sourceHash: 'tb-test-hash-v1',
      bytes: zipBuffer, // MenetBrand API candidate returns ZIP archive containing gtfs.db
      filename: 'tatabanya.zip',
      format: 'menetbrand_sqlite_v5',
      sourceMetadata: {
        provider: 'MenetBrand',
        authorityLevel: 'VERIFIED_AGGREGATOR',
        license: 'Test License',
        attribution: 'MenetBrand',
        redistributionPolicy: 'PUBLIC_REDISTRIBUTION_ALLOWED',
        priority: 10,
      },
      acquiredAt: new Date().toISOString(),
    }),
  };

  const registry = new SourceRegistry([testAdapter]);
  const config = loadConfig({
    MENETBRAND_API_KEY: 'test-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ACCESS_KEY_ID: 'test-key-id',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    PUBLIC_FEED_BASE_URL: 'https://utirany-feed.test',
  });

  const engine = new PublisherEngine(config, registry, storage);
  const summary = await engine.run({ targetFeedId: 'tatabanya-test' });

  assert.equal(summary.publishedCount, 1);
  assert.equal(summary.rejectedCount, 0);

  // Step 5: Verify artifact and manifest exist in R2
  const manifestObj = await storage.getObject('v1/feeds/tatabanya-test/manifest.json');
  assert.ok(manifestObj);
  const manifest = JSON.parse(manifestObj.body.toString('utf8'));
  assert.equal(manifest.feedId, 'tatabanya-test');
  assert.equal(manifest.metrics.stops, 10);
  assert.equal(manifest.metrics.routes, 1);

  const artifactObj = await storage.getObject(`v1/feeds/tatabanya-test/artifacts/${manifest.sha256}.zip`);
  assert.ok(artifactObj);
  assert.equal(artifactObj.body.length, manifest.sizeBytes);
});
