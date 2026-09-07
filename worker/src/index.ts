export interface Env {
  TRANSIT_FEEDS: {
    get(
      key: string,
      options?: {
        onlyIf?: {
          etagMatches?: string;
          etagDoesNotMatch?: string;
          uploadedBefore?: Date;
          uploadedAfter?: Date;
        };
      },
    ): Promise<any>;
    head(key: string): Promise<any>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Health check endpoint
    if (pathname === '/' || pathname === '') {
      return new Response(JSON.stringify({ service: 'utirany-feed', status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Strip leading slash
    let key = pathname.startsWith('/') ? pathname.slice(1) : pathname;

    // Prevent directory traversal
    if (key.includes('..') || key.startsWith('.')) {
      return new Response('Not Found', { status: 404 });
    }

    // Backwards-compatibility aliases for Android OX-DATA-1 / OX-DATA-2
    if (key === 'menetrend/szeged/manifest.json') {
      key = 'v1/feeds/szeged/manifest.json';
    } else if (key.startsWith('menetrend/szeged/gtfs-') && key.endsWith('.zip')) {
      const filename = key.replace('menetrend/szeged/', '');
      const shaMatch = /^gtfs-([a-fA-F0-9]{64})\.zip$/.exec(filename);
      if (shaMatch) {
        key = `v1/feeds/szeged/artifacts/${shaMatch[1].toLowerCase()}.zip`;
      }
    }

    const ifNoneMatch = request.headers.get('if-none-match');

    const object = await env.TRANSIT_FEEDS.get(key, {
      onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch } : undefined,
    });

    if (object === null) {
      if (ifNoneMatch) {
        const head = await env.TRANSIT_FEEDS.head(key);
        if (head && matchesEtag(ifNoneMatch, head.etag)) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: head.etag,
              'Cache-Control': getCacheControl(key),
            },
          });
        }
      }
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    if (object.httpEtag || object.etag) {
      headers.set('ETag', object.httpEtag ?? object.etag);
    }
    headers.set('Cache-Control', getCacheControl(key));
    headers.set('Content-Type', getContentType(key, object.httpMetadata?.contentType));

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  },
};

function matchesEtag(ifNoneMatch: string, objectEtag?: string): boolean {
  if (!objectEtag) return false;
  const cleanHeader = ifNoneMatch.replace(/^W\//, '').replace(/"/g, '').trim();
  const cleanEtag = objectEtag.replace(/^W\//, '').replace(/"/g, '').trim();
  return cleanHeader === cleanEtag || cleanHeader === '*';
}

function getCacheControl(key: string): string {
  if (key.includes('/artifacts/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache, must-revalidate';
}

function getContentType(key: string, metadataType?: string): string {
  if (key.endsWith('.json') || metadataType?.includes('application/json')) {
    return 'application/json; charset=utf-8';
  }
  if (metadataType) return metadataType;
  if (key.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}
