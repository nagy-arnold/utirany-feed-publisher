import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface CanonicalStation {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly active: boolean;
}

export interface CanonicalPhysicalStop {
  readonly id: string;
  readonly stationId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly platform: string | null;
  readonly active: boolean;
}

export interface CanonicalAlias {
  readonly source: string;
  readonly externalId: string;
  readonly canonicalStationId: string;
  readonly canonicalPhysicalStopId: string;
  readonly active: boolean;
}

export interface CanonicalIdentitySnapshot {
  readonly schemaVersion: number;
  readonly stations: CanonicalStation[];
  readonly physicalStops: CanonicalPhysicalStop[];
  readonly aliases: CanonicalAlias[];
}

export class CanonicalRegistry {
  private readonly snapshot: CanonicalIdentitySnapshot;
  private readonly aliasMap: Map<string, string> = new Map();

  constructor(snapshot: CanonicalIdentitySnapshot) {
    this.snapshot = snapshot;
    for (const alias of snapshot.aliases) {
      if (alias.active) {
        const key = `${alias.source}:${alias.externalId}`;
        this.aliasMap.set(key, alias.canonicalPhysicalStopId);
      }
    }
  }

  static loadFromFile(filePath: string): CanonicalRegistry {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as CanonicalIdentitySnapshot;
    return new CanonicalRegistry(data);
  }

  static loadDefaultSzeged(): CanonicalRegistry {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const registryPath = resolve(__dirname, 'szeged-canonical-identity-v1.json');
    return CanonicalRegistry.loadFromFile(registryPath);
  }

  getCanonicalStopId(source: string, externalId: string): string | undefined {
    return this.aliasMap.get(`${source}:${externalId}`);
  }

  getSnapshot(): CanonicalIdentitySnapshot {
    return this.snapshot;
  }
}
