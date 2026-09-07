import AdmZip from 'adm-zip';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');

export interface MenetBrandDbValidation {
  readonly isValid: boolean;
  readonly dbVersion: number;
  readonly payloadFilename: string;
  readonly issues: string[];
}

/**
 * Safely unzips and extracts the SQLite v5 database from a MenetBrand download artifact.
 * Supports both raw SQLite database buffers and ZIP containers containing gtfs.db.
 */
export function extractMenetBrandDatabase(bytes: Buffer): {
  databaseBuffer: Buffer;
  sourceType: 'raw_sqlite' | 'zip_archive';
  entryName: string;
} {
  // 1. Check if already raw SQLite
  if (bytes.length >= 16 && bytes.subarray(0, 16).equals(SQLITE_MAGIC)) {
    return {
      databaseBuffer: bytes,
      sourceType: 'raw_sqlite',
      entryName: 'gtfs.db',
    };
  }

  // 2. Check if ZIP container
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(bytes);
    } catch (err: any) {
      throw new Error(`Failed to parse MenetBrand ZIP container: ${err.message}`);
    }

    const entries = zip.getEntries();
    // Look for gtfs.db first, then any .db or .sqlite
    let dbEntry = entries.find(
      (e) => !e.isDirectory && (e.entryName === 'gtfs.db' || e.entryName.endsWith('/gtfs.db') || e.entryName.endsWith('\\gtfs.db')),
    );
    if (!dbEntry) {
      dbEntry = entries.find(
        (e) => !e.isDirectory && (e.entryName.endsWith('.db') || e.entryName.endsWith('.sqlite')),
      );
    }

    if (!dbEntry) {
      const entryNames = entries.map((e) => e.entryName).join(', ');
      throw new Error(`MenetBrand ZIP container does not contain gtfs.db (entries: [${entryNames}])`);
    }

    const dbBuffer = dbEntry.getData();
    if (dbBuffer.length < 16 || !dbBuffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
      throw new Error(`Extracted entry '${dbEntry.entryName}' is not a valid SQLite database (missing SQLite magic header)`);
    }

    return {
      databaseBuffer: dbBuffer,
      sourceType: 'zip_archive',
      entryName: dbEntry.entryName,
    };
  }

  throw new Error('MenetBrand candidate is neither a raw SQLite database nor a valid ZIP container');
}

/**
 * Validates that a SQLite database buffer adheres to the MenetBrand SQLite v5 contract.
 */
export function validateMenetBrandDatabaseSchema(databaseBuffer: Buffer): MenetBrandDbValidation {
  const issues: string[] = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-val-'));
  const dbPath = path.join(tmpDir, 'check.db');
  fs.writeFileSync(dbPath, databaseBuffer);

  let dbVersion = 0;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      // 1. Check app_meta db_version
      const metaRow = db.prepare("SELECT value FROM app_meta WHERE key = 'db_version'").get() as
        | { value?: string }
        | undefined;
      if (!metaRow || !metaRow.value) {
        issues.push("Missing 'db_version' in app_meta table");
      } else {
        dbVersion = parseInt(metaRow.value, 10);
        if (dbVersion !== 5) {
          issues.push(`Expected database version 5, got ${metaRow.value}`);
        }
      }

      // 2. Check essential tables and views
      const tables = new Set(
        (
          db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as Array<{
            name: string;
          }>
        ).map((r) => r.name),
      );

      const required = [
        'app_meta',
        'agency',
        'route',
        'stop',
        'stop_info',
        'trip',
        'direction',
        'stop_set',
        'trip_initial_times',
        'trip_delta_times',
      ];

      for (const req of required) {
        if (!tables.has(req)) {
          issues.push(`Missing required table/view '${req}' in MenetBrand SQLite database`);
        }
      }
    } finally {
      db.close();
    }
  } catch (err: any) {
    issues.push(`SQLite query failed: ${err.message}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  return {
    isValid: issues.length === 0,
    dbVersion,
    payloadFilename: 'gtfs.db',
    issues,
  };
}
