import assert from 'node:assert/strict';
import test from 'node:test';
import { BkkStaticGtfsSourceAdapter } from '../src/sources/bkk/adapter.js';

test('BkkStaticGtfsSourceAdapter extracts ETag and Last-Modified metadata', async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          etag: '"test-etag-1234"',
          'last-modified': 'Sun, 06 Sep 2026 22:00:00 GMT',
          'content-length': '48000000',
        },
      });
    }
    return new Response(Buffer.from('PK\x03\x04fake-zip-bytes'), {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    });
  };

  const adapter = new BkkStaticGtfsSourceAdapter({ fetchImpl: fakeFetch });
  const meta = await adapter.fetchMetadata('budapest');
  assert.ok(meta);
  assert.ok(meta.sourceHash.length > 0);
  assert.equal(meta.upstreamVersion, 'test-etag-1234');

  const feeds = await adapter.discoverFeeds();
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].feedId, 'budapest');
  assert.equal(feeds[0].format, 'gtfs_zip');

  const candidate = await adapter.acquireCandidate(feeds[0]);
  assert.equal(candidate.feedId, 'budapest');
  assert.equal(candidate.format, 'gtfs_zip');
  assert.ok(candidate.bytes.length > 0);
});
