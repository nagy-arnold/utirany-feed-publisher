import { R2Storage } from '../r2/types.js';

export interface RetentionOptions {
  readonly maxHistoricArtifactsPerFeed?: number;
  readonly dryRun?: boolean;
}

export interface RetentionReport {
  readonly feedId: string;
  readonly retainedKeys: string[];
  readonly deletedKeys: string[];
  readonly totalFreedBytes: number;
}

export async function cleanFeedHistoricArtifacts(
  storage: R2Storage,
  feedId: string,
  activeContentSha256: string,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const maxHistoric = options.maxHistoricArtifactsPerFeed ?? 1;
  const prefix = `v1/feeds/${feedId}/artifacts/`;
  const items = await storage.listObjects(prefix);

  const activeKey = `${prefix}${activeContentSha256.toLowerCase()}.zip`;
  const nonActiveItems = items.filter((item) => item.key !== activeKey);

  nonActiveItems.sort((a, b) => {
    const timeA = a.lastModified ? a.lastModified.getTime() : 0;
    const timeB = b.lastModified ? b.lastModified.getTime() : 0;
    return timeB - timeA;
  });

  const retainedKeys = [activeKey];
  const itemsToKeep = nonActiveItems.slice(0, maxHistoric);
  for (const item of itemsToKeep) {
    retainedKeys.push(item.key);
  }

  const itemsToDelete = nonActiveItems.slice(maxHistoric);
  const deletedKeys: string[] = [];
  let totalFreedBytes = 0;

  for (const item of itemsToDelete) {
    if (!options.dryRun) {
      await storage.deleteObject(item.key);
    }
    deletedKeys.push(item.key);
    totalFreedBytes += item.size;
  }

  return {
    feedId,
    retainedKeys,
    deletedKeys,
    totalFreedBytes,
  };
}
