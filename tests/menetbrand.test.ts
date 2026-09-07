import assert from 'node:assert/strict';
import test from 'node:test';
import { MenetBrandClient } from '../src/sources/menetbrand/client.js';
import { QuotaExhaustedError, ProviderHttpError } from '../src/sources/menetbrand/errors.js';

test('MenetBrandClient classifies ERROR_API_KEY_LIMIT_REACHED as QuotaExhaustedError', async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        result: 'failure',
        error_info: 'ERROR_API_KEY_LIMIT_REACHED',
        error_details: 'Daily limit reached',
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new MenetBrandClient({
    apiKey: 'dummy-key',
    fetchImpl: fakeFetch,
  });

  await assert.rejects(
    async () => {
      await client.info('szeged');
    },
    (err: any) => {
      assert.ok(err instanceof QuotaExhaustedError);
      assert.equal(err.name, 'QuotaExhaustedError');
      return true;
    },
  );
});

test('MenetBrandClient throws ProviderHttpError on 500 error without exposing secret', async () => {
  const secretKey = 'super-secret-key-xyz';
  const fakeFetch: typeof fetch = async () => {
    return new Response('Server Error', { status: 500 });
  };

  const client = new MenetBrandClient({
    apiKey: secretKey,
    fetchImpl: fakeFetch,
  });

  await assert.rejects(
    async () => {
      await client.config();
    },
    (err: any) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.equal(err.status, 500);
      assert.equal(err.message.includes(secretKey), false);
      return true;
    },
  );
});
