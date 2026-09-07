import assert from 'node:assert/strict';
import test from 'node:test';
import { CanonicalRegistry } from '../src/canonical/registry.js';
import { canonicalizeGtfsFiles } from '../src/canonical/canonicalize.js';

const sampleSnapshot = {
  schemaVersion: 1,
  stations: [
    { id: 'utirany:station:1', name: 'Anna-kút', latitude: 46.256, longitude: 20.148, active: true },
  ],
  physicalStops: [
    { id: 'utirany:physical_stop:p1', stationId: 'utirany:station:1', name: 'Anna-kút', latitude: 46.256, longitude: 20.148, platform: null, active: true },
    { id: 'utirany:physical_stop:p2', stationId: 'utirany:station:2', name: 'Mars tér', latitude: 46.253, longitude: 20.142, platform: null, active: true },
  ],
  aliases: [
    { source: 'MENETBRAND_SZEGED', externalId: 'SZKT_101', canonicalStationId: 'utirany:station:1', canonicalPhysicalStopId: 'utirany:physical_stop:p1', active: true },
    { source: 'MENETBRAND_SZEGED', externalId: 'SZKT_102', canonicalStationId: 'utirany:station:2', canonicalPhysicalStopId: 'utirany:physical_stop:p2', active: true },
  ],
};

test('canonicalizeGtfsFiles rewrites stop_ids to canonical physical identities', () => {
  const registry = new CanonicalRegistry(sampleSnapshot as any);

  const files = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nSZKT_101,Anna-kút,46.256,20.148\nSZKT_102,Mars tér,46.253,20.142\n'],
    ['stop_times.txt', 'trip_id,stop_sequence,stop_id\nT1,1,SZKT_101\nT1,2,SZKT_102\n'],
    ['routes.txt', 'route_id,route_short_name\nR1,2\n'],
  ]);

  const result = canonicalizeGtfsFiles(files, registry, 'MENETBRAND_SZEGED');
  const rewrittenStops = result.files.get('stops.txt')!;
  const rewrittenStopTimes = result.files.get('stop_times.txt')!;

  assert.ok(rewrittenStops.includes('utirany:physical_stop:p1,Anna-kút'));
  assert.ok(rewrittenStops.includes('utirany:physical_stop:p2,Mars tér'));
  assert.equal(rewrittenStops.includes('SZKT_101'), false);

  assert.ok(rewrittenStopTimes.includes('T1,1,utirany:physical_stop:p1'));
  assert.ok(rewrittenStopTimes.includes('T1,2,utirany:physical_stop:p2'));
});

test('canonicalizeGtfsFiles rejects unknown stops without canonical mapping', () => {
  const registry = new CanonicalRegistry(sampleSnapshot as any);

  const files = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nSZKT_UNKNOWN,Unknown,46.256,20.148\n'],
    ['stop_times.txt', 'trip_id,stop_sequence,stop_id\nT1,1,SZKT_UNKNOWN\n'],
  ]);

  assert.throws(
    () => canonicalizeGtfsFiles(files, registry, 'MENETBRAND_SZEGED'),
    /has no canonical identity/,
  );
});
