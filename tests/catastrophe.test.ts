import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCatastropheDrop } from '../src/gtfs/catastrophe.js';
import { GtfsMetrics } from '../src/gtfs/validator.js';

function makeMetrics(overrides: Partial<GtfsMetrics> = {}): GtfsMetrics {
  return {
    stopCount: 1000,
    routeCount: 50,
    tripCount: 2000,
    stopTimeCount: 30000,
    shapeCount: 50,
    serviceCount: 10,
    coverageStart: '2026-09-01',
    coverageEnd: '2026-10-31',
    agencyTimeZone: 'Europe/Budapest',
    ...overrides,
  };
}

test('checkCatastropheDrop rejects absolute count drops below minimums', () => {
  const result = checkCatastropheDrop(makeMetrics({ stopCount: 5 }), null);
  assert.equal(result.isCatastrophe, true);
  assert.ok(result.reason?.includes('Megállók száma gyanúsan alacsony'));
});

test('checkCatastropheDrop rejects severe drops relative to LKG (>80% drop)', () => {
  const lkg = makeMetrics({ stopCount: 1000 });
  const candidate = makeMetrics({ stopCount: 150 }); // 85% drop
  const result = checkCatastropheDrop(candidate, lkg);
  assert.equal(result.isCatastrophe, true);
  assert.ok(result.reason?.includes('Túl nagy megállószám-csökkenés'));
});

test('checkCatastropheDrop accepts legitimate network changes (e.g. 5-10% changes)', () => {
  const lkg = makeMetrics({ stopCount: 1000, routeCount: 50, tripCount: 2000, stopTimeCount: 30000 });
  const candidate = makeMetrics({ stopCount: 980, routeCount: 51, tripCount: 1950, stopTimeCount: 29800 });
  const result = checkCatastropheDrop(candidate, lkg);
  assert.equal(result.isCatastrophe, false);
  assert.equal(result.reason, null);
});
