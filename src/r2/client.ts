import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PublisherConfig } from '../config/env.js';
import { R2ListedItem, R2ObjectData, R2ObjectMetadata, R2PutOptions, R2Storage } from './types.js';

export class S3R2Storage implements R2Storage {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(config: PublisherConfig) {
    if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
      throw new Error('R2 credentials (accountId, accessKeyId, secretAccessKey) are required');
    }

    this.bucketName = config.r2BucketName;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  async getObject(key: string): Promise<R2ObjectData | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;

      const bytes = Buffer.from(await response.Body.transformToByteArray());
      return {
        body: bytes,
        contentLength: response.ContentLength ?? bytes.length,
        contentType: response.ContentType,
        etag: response.ETag,
        lastModified: response.LastModified,
      };
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async headObject(key: string): Promise<R2ObjectMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
        etag: response.ETag,
        lastModified: response.LastModified,
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async putObject(key: string, body: Buffer, options?: R2PutOptions): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: options?.contentType,
      CacheControl: options?.cacheControl,
    });
    await this.client.send(command);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.client.send(command);
  }

  async listObjects(prefix?: string): Promise<R2ListedItem[]> {
    const items: R2ListedItem[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const resp = (await this.client.send(cmd)) as ListObjectsV2CommandOutput;

      for (const obj of resp.Contents ?? []) {
        if (obj.Key) {
          items.push({
            key: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified,
            etag: obj.ETag,
          });
        }
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    return items;
  }
}
