export interface R2ObjectMetadata {
  readonly contentLength: number;
  readonly contentType?: string;
  readonly etag?: string;
  readonly lastModified?: Date;
}

export interface R2ObjectData extends R2ObjectMetadata {
  readonly body: Buffer;
}

export interface R2PutOptions {
  readonly contentType?: string;
  readonly cacheControl?: string;
}

export interface R2ListedItem {
  readonly key: string;
  readonly size: number;
  readonly lastModified?: Date;
  readonly etag?: string;
}

export interface R2Storage {
  getObject(key: string): Promise<R2ObjectData | null>;
  headObject(key: string): Promise<R2ObjectMetadata | null>;
  putObject(key: string, body: Buffer, options?: R2PutOptions): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix?: string): Promise<R2ListedItem[]>;
}
