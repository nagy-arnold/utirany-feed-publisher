import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGtfsPackage, isValidGtfsTime } from '../src/gtfs/validator.js';
import { createZip } from '../src/gtfs/zip.js';

function validSampleFiles(): Map<string, string> {
  return new Map([
    ['agency.txt', 'agency_id,agency_name,agency_url,agency_timezone\nSZKT,Szeged Közlekedési Kft,http://szkt.hu,Europe/Budapest\n'],
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nutirany:physical_stop:s1,Anna-kút,46.2559,20.1485\nutirany:physical_stop:s2,Mars tér,46.2556,20.1412\n'],
    ['routes.txt', 'route_id,route_short_name,route_type\nR1,2,0\n'],
    ['trips.txt', 'trip_id,route_id,service_id\nT1,R1,S1\n'],
    ['stop_times.txt', 'trip_id,stop_sequence,stop_id,arrival_time,departure_time\nT1,1,utirany:physical_stop:s1,08:00:00,08:00:30\nT1,2,utirany:physical_stop:s2,08:05:00,08:05:30\n'],
    ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,1,1,20260901,20261031\n'],
    ['shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH1,46.2559,20.1485,1\nSH1,46.2556,20.1412,2\n'],
  ]);
}

test('validateGtfsPackage accepts valid standard GTFS files', () => {
  const result = validateGtfsPackage(validSampleFiles());
  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.metrics.stopCount, 2);
  assert.equal(result.metrics.routeCount, 1);
  assert.equal(result.metrics.tripCount, 1);
  assert.equal(result.metrics.stopTimeCount, 2);
  assert.equal(result.metrics.shapeCount, 1);
  assert.equal(result.metrics.agencyTimeZone, 'Europe/Budapest');
  assert.equal(result.metrics.coverageStart, '2026-09-01');
  assert.equal(result.metrics.coverageEnd, '2026-10-31');
});

test('validateGtfsPackage validates ZIP buffers', () => {
  const zipBuf = createZip(validSampleFiles());
  const result = validateGtfsPackage(zipBuf);
  assert.equal(result.isValid, true);
});

test('validateGtfsPackage rejects missing required files', () => {
  const files = validSampleFiles();
  files.delete('routes.txt');
  const result = validateGtfsPackage(files);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('Missing required GTFS file: routes.txt')));
});

test('validateGtfsPackage rejects broken referential integrity (unknown route in trip)', () => {
  const files = validSampleFiles();
  files.set('trips.txt', 'trip_id,route_id,service_id\nT1,UNKNOWN_ROUTE,S1\n');
  const result = validateGtfsPackage(files);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes("references unknown route_id 'UNKNOWN_ROUTE'")));
});

test('validateGtfsPackage rejects broken referential integrity (unknown stop in stop_times)', () => {
  const files = validSampleFiles();
  files.set(
    'stop_times.txt',
    'trip_id,stop_sequence,stop_id,arrival_time,departure_time\nT1,1,NON_EXISTENT_STOP,08:00:00,08:05:00\n',
  );
  const result = validateGtfsPackage(files);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('referencing unknown stops')));
});

test('isValidGtfsTime accepts service times beyond 24:00', () => {
  assert.equal(isValidGtfsTime('07:30:00'), true);
  assert.equal(isValidGtfsTime('23:59:59'), true);
  assert.equal(isValidGtfsTime('24:15:00'), true);
  assert.equal(isValidGtfsTime('26:45:10'), true);
  assert.equal(isValidGtfsTime('invalid'), false);
  assert.equal(isValidGtfsTime('24:60:00'), false);
});
