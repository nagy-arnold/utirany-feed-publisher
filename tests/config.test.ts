import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, normalizeBaseUrl } from '../src/config/env.js';

test('loadConfig parses valid environment variables', () => {
  const env = {
    MENETBRAND_API_KEY: 'test-api-key',
    R2_ACCOUNT_ID: 'test-account-id',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    PUBLIC_FEED_BASE_URL: 'https://feed.example.com/',
    FEED_PUBLISHER_DRY_RUN: 'true',
  };

  const config = loadConfig(env);
  assert.equal(config.r2BucketName, 'test-bucket');
  assert.equal(config.publicFeedBaseUrl, 'https://feed.example.com');
  assert.equal(config.isDryRun, true);
  assert.equal(config.hasR2Credentials, true);
  assert.equal(config.hasMenetBrandCredentials, true);
});

test('normalizeBaseUrl strips trailing slashes and validates protocol', () => {
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com/v1/'), 'https://example.com/v1');
  assert.throws(() => normalizeBaseUrl('ftp://example.com'), /Malformed PUBLIC_FEED_BASE_URL/);
});

test('PublisherConfig does not expose secret values in inspection or serialization', () => {
  const secretKey = 'super-secret-key-12345';
  const config = loadConfig({
    MENETBRAND_API_KEY: secretKey,
    R2_SECRET_ACCESS_KEY: 'r2-super-secret',
  });

  const str = config.toString();
  assert.equal(str.includes(secretKey), false);
  assert.equal(str.includes('r2-super-secret'), false);

  const json = JSON.stringify(config);
  assert.equal(json.includes(secretKey), false);
  assert.equal(json.includes('r2-super-secret'), false);
});
