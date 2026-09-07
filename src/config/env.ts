export interface PublisherConfig {
  readonly menetbrandApiKey: string | null;
  readonly r2AccountId: string | null;
  readonly r2BucketName: string;
  readonly r2AccessKeyId: string | null;
  readonly r2SecretAccessKey: string | null;
  readonly publicFeedBaseUrl: string;
  readonly isDryRun: boolean;
  readonly hasR2Credentials: boolean;
  readonly hasMenetBrandCredentials: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PublisherConfig {
  const menetbrandApiKey = env.MENETBRAND_API_KEY?.trim() || null;
  const r2AccountId = env.R2_ACCOUNT_ID?.trim() || null;
  const r2BucketName = env.R2_BUCKET_NAME?.trim() || 'utirany-transit-feeds';
  const r2AccessKeyId = env.R2_ACCESS_KEY_ID?.trim() || null;
  const r2SecretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() || null;

  const rawBaseUrl = env.PUBLIC_FEED_BASE_URL?.trim() || 'https://utirany-feed.tir-ny.workers.dev';
  const publicFeedBaseUrl = normalizeBaseUrl(rawBaseUrl);

  const isDryRun = env.FEED_PUBLISHER_DRY_RUN === 'true' || env.FEED_PUBLISHER_DRY_RUN === '1';

  const hasR2Credentials = Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey);
  const hasMenetBrandCredentials = Boolean(menetbrandApiKey);

  const config: PublisherConfig = {
    menetbrandApiKey,
    r2AccountId,
    r2BucketName,
    r2AccessKeyId,
    r2SecretAccessKey,
    publicFeedBaseUrl,
    isDryRun,
    hasR2Credentials,
    hasMenetBrandCredentials,
  };

  Object.defineProperty(config, 'toString', {
    value: () =>
      'PublisherConfig(r2Bucket: ' + r2BucketName + ', baseUrl: ' + publicFeedBaseUrl + ', hasR2: ' + hasR2Credentials + ', hasMenetBrand: ' + hasMenetBrandCredentials + ', dryRun: ' + isDryRun + ')',
    enumerable: false,
  });

  Object.defineProperty(config, 'toJSON', {
    value: () => ({
      r2BucketName,
      publicFeedBaseUrl,
      isDryRun,
      hasR2Credentials,
      hasMenetBrandCredentials,
    }),
    enumerable: false,
  });

  return config;
}

export function normalizeBaseUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid base URL protocol: ${url.protocol}`);
    }
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch (cause) {
    throw new Error(`Malformed PUBLIC_FEED_BASE_URL: '${urlStr}'`, { cause });
  }
}
