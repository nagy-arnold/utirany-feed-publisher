import {
  ProviderContractError,
  ProviderHttpError,
  ProviderNetworkError,
  QuotaExhaustedError,
} from './errors.js';
import {
  MenetBrandConfig,
  MenetBrandInfo,
  parseMenetBrandConfig,
  parseMenetBrandInfo,
} from './types.js';

export interface MenetBrandClientOptions {
  baseUrl?: string;
  apiKey?: string;
  serviceVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface MenetBrandArtifact {
  readonly bytes: Buffer;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly filename: string | null;
}

export class MenetBrandClient {
  #apiKey: string;
  #fetchImpl: typeof fetch;

  readonly baseUrl: string;
  readonly serviceVersion: string;

  constructor(options: MenetBrandClientOptions = {}) {
    const apiKey = (options.apiKey ?? process.env.MENETBRAND_API_KEY ?? '').trim();
    this.#apiKey = apiKey;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.menetbrand.com/').replace(/\/+$/, '') + '/';
    this.serviceVersion = options.serviceVersion ?? '3.0.0';
  }

  get isConfigured(): boolean {
    return Boolean(this.#apiKey);
  }

  async config(signal?: AbortSignal): Promise<MenetBrandConfig> {
    const response = await this.requestJson('/hungary/gtfs/config', undefined, signal);
    return parseMenetBrandConfig(response);
  }

  async info(
    configId: string,
    timetablePeriod?: string,
    signal?: AbortSignal,
  ): Promise<MenetBrandInfo> {
    const params = new URLSearchParams({ config_id: configId });
    if (timetablePeriod !== undefined) params.set('timetable_period', timetablePeriod);
    const response = await this.requestJson('/hungary/gtfs/info', params, signal);
    return parseMenetBrandInfo(response);
  }

  async download(
    configId: string,
    format: 'db' | 'zip' | '7z' = 'zip',
    timetablePeriod?: string,
    signal?: AbortSignal,
  ): Promise<MenetBrandArtifact> {
    const params = new URLSearchParams({ config_id: configId, type: format });
    if (timetablePeriod !== undefined) params.set('timetable_period', timetablePeriod);
    const response = await this.request('/hungary/gtfs/download', params, signal);

    const arrayBuf = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    const contentLengthRaw = response.headers.get('content-length');
    const contentLength = contentLengthRaw !== null ? Number(contentLengthRaw) : bytes.length;

    return {
      bytes,
      contentType: response.headers.get('content-type'),
      contentLength: Number.isFinite(contentLength) ? contentLength : bytes.length,
      filename: parseFilename(response.headers.get('content-disposition')),
    };
  }

  private async requestJson(
    path: string,
    params?: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(path, params, signal);
    try {
      return await response.json();
    } catch {
      throw new ProviderContractError(`Response was not valid JSON at ${path}`);
    }
  }

  private async request(
    path: string,
    params?: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!this.#apiKey) {
      throw new Error('MENETBRAND_API_KEY is not configured');
    }

    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(cleanPath, this.baseUrl);
    if (params !== undefined) {
      for (const [key, value] of params) url.searchParams.set(key, value);
    }

    const headers = new Headers({
      'Service-Version': this.serviceVersion,
      Authorization: `Basic ${this.#apiKey}`,
      Accept: 'application/json, application/octet-stream',
    });

    let response: Response;
    try {
      response = await this.#fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal,
      });
    } catch (err) {
      throw new ProviderNetworkError(path, err);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        try {
          const bodyText = await response.text();
          if (bodyText.includes('ERROR_API_KEY_LIMIT_REACHED')) {
            throw new QuotaExhaustedError();
          }
        } catch (e) {
          if (e instanceof QuotaExhaustedError) throw e;
        }
      }
      throw new ProviderHttpError(response.status, path);
    }

    return response;
  }
}

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename\*?=(?:UTF-8''|\")?([^;\"]+)/i.exec(contentDisposition);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1].trim());
  const normalized = decoded.replaceAll('\\', '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return basename === '' || basename === '.' || basename === '..' ? null : basename;
}
