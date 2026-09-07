import { R2ListedItem, R2ObjectData, R2ObjectMetadata, R2PutOptions, R2Storage } from './types.js';
import { createHash } from 'node:crypto';

export class MemoryR2Storage implements R2Storage {
  private readonly storage = new Map<
    string,
    {
      body: Buffer;
      contentType?: string;
      cacheControl?: string;
      etag: string;
      lastModified: Date;
    }
  >();

  async getObject(key: string): Promise<R2ObjectData | null> {
    const item = this.storage.get(key);
    if (!item) return null;
    return {
      body: item.body,
      contentLength: item.body.length,
      contentType: item.contentType,
      etag: item.etag,
      lastModified: item.lastModified,
    };
  }

  async headObject(key: string): Promise<R2ObjectMetadata | null> {
    const item = this.storage.get(key);
    if (!item) return null;
    return {
      contentLength: item.body.length,
      contentType: item.contentType,
      etag: item.etag,
      lastModified: item.lastModified,
    };
  }

  async putObject(key: string, body: Buffer, options?: R2PutOptions): Promise<void> {
    const etag = `"${createHash('md5').update(body).digest('hex')}"`;
    this.storage.set(key, {
      body: Buffer.from(body),
      contentType: options?.contentType,
      cacheControl: options?.cacheControl,
      etag,
      lastModified: new Date(),
    });
  }

  async deleteObject(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async listObjects(prefix?: string): Promise<R2ListedItem[]> {
    const items: R2ListedItem[] = [];
    for (const [key, item] of this.storage.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        items.push({
          key,
          size: item.body.length,
          lastModified: item.lastModified,
          etag: item.etag,
        });
      }
    }
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  hasKey(key: string): boolean {
    return this.storage.has(key);
  }

  clear(): void {
    this.storage.clear();
  }
}
