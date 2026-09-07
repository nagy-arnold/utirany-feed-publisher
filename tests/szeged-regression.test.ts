import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySzegedSemanticRegression } from '../src/publisher/engine.js';

test('verifySzegedSemanticRegression passes for compliant canonical Szeged feed', () => {
  const compliantFiles = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nutirany:physical_stop:s1,Anna-kút,46.25,20.14\nutirany:physical_stop:14cf,BYD,46.28,20.08\n'],
    ['routes.txt', 'route_id,agency_id,route_short_name,route_type\nR2,1,2,0\nR4,1,4,0\nR8,1,8,11\nR10,1,10,11\nR19,1,19,11\nR72,2,72,3\nR84,2,84,3\nR90,2,90,3\nR90H,2,90H,3\n'],
    ['trips.txt', 'trip_id,route_id,service_id,trip_headsign\nT_90H_1,R90H,S1,Szeged, BYD (5-ös számú főút)\n'],
  ]);

  const error = verifySzegedSemanticRegression(compliantFiles);
  assert.equal(error, null);
});

test('verifySzegedSemanticRegression rejects non-canonical stop IDs', () => {
  const nonCanonicalFiles = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nRAW_STOP_123,Anna-kút,46.25,20.14\n'],
    ['routes.txt', 'route_id,agency_id,route_short_name,route_type\n'],
    ['trips.txt', 'trip_id,route_id,service_id\n'],
  ]);

  const error = verifySzegedSemanticRegression(nonCanonicalFiles);
  assert.ok(error?.includes('Non-canonical stop ID found'));
});

test('verifySzegedSemanticRegression rejects missing representative routes', () => {
  const missingRoutesFiles = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nutirany:physical_stop:s1,Anna-kút,46.25,20.14\n'],
    ['routes.txt', 'route_id,agency_id,route_short_name,route_type\nR2,1,2,0\n'], // Only route 2, missing 4, 8, etc.
    ['trips.txt', 'trip_id,route_id,service_id\n'],
  ]);

  const error = verifySzegedSemanticRegression(missingRoutesFiles);
  assert.ok(error?.includes("Representative route '4' missing"));
});

test('verifySzegedSemanticRegression rejects missing 90H BYD canary', () => {
  const noBydFiles = new Map<string, string>([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nutirany:physical_stop:s1,Anna-kút,46.25,20.14\n'],
    ['routes.txt', 'route_id,agency_id,route_short_name,route_type\nR2,1,2,0\nR4,1,4,0\nR8,1,8,11\nR10,1,10,11\nR19,1,19,11\nR72,2,72,3\nR84,2,84,3\nR90,2,90,3\nR90H,2,90H,3\n'],
    ['trips.txt', 'trip_id,route_id,service_id,trip_headsign\nT1,R2,S1,Európa liget\n'], // No BYD trip
  ]);

  const error = verifySzegedSemanticRegression(noBydFiles);
  assert.ok(error?.includes('90H BYD canary failed'));
});
