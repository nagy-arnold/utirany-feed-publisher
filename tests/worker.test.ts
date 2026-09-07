import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/src/index.js';

class FakeR2Bucket {
  private readonly objects = new Map<string, { body: string; etag: string; contentType?: string }>();

  put(key: string, body: string, etag: string, contentType?: string) {
    this.objects.set(key, { body, etag, contentType });
  }

  async get(key: string, options?: any) {
    const item = this.objects.get(key);
    if (!item) return null;

    if (options?.onlyIf?.etagDoesNotMatch) {
      const match = options.onlyIf.etagDoesNotMatch.replace(/^W\//, '').replace(/"/g, '').trim();
      const itemEtag = item.etag.replace(/^W\//, '').replace(/"/g, '').trim();
      if (match === itemEtag) {
        return null; // Condition not met (not modified)
      }
    }

    return {
      body: item.body,
      etag: item.etag,
      httpEtag: item.etag,
      httpMetadata: { contentType: item.contentType },
    };
  }

  async head(key: string) {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      etag: item.etag,
    };
  }
}

test('Worker handles / health check with 200 JSON', async () => {
  const env = { TRANSIT_FEEDS: new FakeR2Bucket() };
  const req = new Request('https://utirany-feed.tir-ny.workers.dev/');
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.service, 'utirany-feed');
  assert.equal(json.status, 'ok');
});

test('Worker serves catalog and propagates ETag', async () => {
  const bucket = new FakeR2Bucket();
  bucket.put('v1/catalog.json', '{"schemaVersion":1}', '"etag-catalog-123"', 'application/json');

  const env = { TRANSIT_FEEDS: bucket };
  const req = new Request('https://utirany-feed.tir-ny.workers.dev/v1/catalog.json');
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('etag'), '"etag-catalog-123"');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(await res.text(), '{"schemaVersion":1}');
});

test('Worker returns 304 on matching If-None-Match header', async () => {
  const bucket = new FakeR2Bucket();
  bucket.put('v1/feeds/szeged/manifest.json', '{"feedId":"szeged"}', '"etag-manifest-abc"', 'application/json');

  const env = { TRANSIT_FEEDS: bucket };
  const req = new Request('https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/manifest.json', {
    headers: { 'If-None-Match': '"etag-manifest-abc"' },
  });
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 304);
});

test('Worker routes legacy /menetrend/szeged/manifest.json path to v1/feeds/szeged/manifest.json', async () => {
  const bucket = new FakeR2Bucket();
  bucket.put('v1/feeds/szeged/manifest.json', '{"legacy":"compatible"}', '"etag-szeged"');

  const env = { TRANSIT_FEEDS: bucket };
  const req = new Request('https://utirany-feed.tir-ny.workers.dev/menetrend/szeged/manifest.json');
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, '{"legacy":"compatible"}');
});

test('Worker rejects mutation requests with 405 Method Not Allowed', async () => {
  const env = { TRANSIT_FEEDS: new FakeR2Bucket() };
  const req = new Request('https://utirany-feed.tir-ny.workers.dev/v1/catalog.json', { method: 'POST' });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 405);
});
