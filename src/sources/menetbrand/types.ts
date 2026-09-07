import { ProviderContractError } from './errors.js';

export interface MenetBrandInfo {
  config_id?: string;
  hash: string;
  checksum?: string;
  trips_begin: string;
  trips_end: string;
  created: string;
  trips_count?: number;
  timetable_period?: string;
  db_version?: number;
  included_configs: string[];
  [key: string]: unknown;
}

export interface MenetBrandRegion {
  catalogKey?: string;
  folder?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  export_as_child?: boolean;
  export_mode?: string | null;
  contains?: string[] | null;
  [key: string]: unknown;
}

export interface MenetBrandBuildConfig {
  catalogKey?: string;
  id?: number;
  enabled?: boolean;
  name?: string;
  folder?: string;
  type?: string;
  source_url?: string | null;
  export_child?: boolean;
  data_prefix?: string;
  trim_to_days?: number | null;
  extends_shapes?: number | null;
  [key: string]: unknown;
}

export interface MenetBrandReleaseConfig {
  catalogKey?: string;
  config_id?: string;
  folder?: string;
  enabled?: boolean;
  merge?: string[];
  from?: string;
  [key: string]: unknown;
}

export interface MenetBrandConfig {
  route_types: Array<Record<string, unknown>>;
  regions: Record<string, MenetBrandRegion>;
  build_configs: Record<string, MenetBrandBuildConfig>;
  release_configs: Record<string, MenetBrandReleaseConfig>;
  timetable_config?: { trim_to_days?: number[] };
  [key: string]: unknown;
}

export function parseMenetBrandInfo(value: unknown): MenetBrandInfo {
  if (!isRecord(value)) {
    throw new ProviderContractError('MenetBrand info response must be an object');
  }
  const payload = isRecord(value.data) ? value.data : value;
  const hash = optionalString(payload, 'hash') ?? requiredString(payload, 'checksum');
  const tripsBegin = requiredString(payload, 'trips_begin');
  const tripsEnd = requiredString(payload, 'trips_end');
  const created = requiredString(payload, 'created');
  const included = payload.included_configs;
  if (!Array.isArray(included) || !included.every((item) => typeof item === 'string')) {
    throw new ProviderContractError('MenetBrand info field included_configs must be a string array');
  }
  return {
    ...payload,
    hash,
    checksum: optionalString(payload, 'checksum'),
    trips_begin: tripsBegin,
    trips_end: tripsEnd,
    created,
    included_configs: [...included],
  };
}

export function parseMenetBrandConfig(value: unknown): MenetBrandConfig {
  if (!isRecord(value)) {
    throw new ProviderContractError('MenetBrand config response must be an object');
  }
  const payload = isRecord(value.data) ? value.data : value;
  return {
    route_types: Array.isArray(payload.route_types) ? payload.route_types : Object.values(payload.route_types ?? {}),
    regions: ensureRecordMap(payload.regions, 'regions'),
    build_configs: ensureRecordMap(payload.build_configs, 'build_configs'),
    release_configs: ensureRecordMap(payload.release_configs, 'release_configs'),
    timetable_config: isRecord(payload.timetable_config) ? (payload.timetable_config as { trim_to_days?: number[] }) : undefined,
  };
}

function ensureRecordMap<T>(value: unknown, _fieldName: string): Record<string, T> {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      const map: Record<string, T> = {};
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isRecord(item)) {
          const key = (item.catalogKey as string) ?? (item.config_id as string) ?? String(i);
          map[key] = item as T;
        }
      }
      return map;
    }
    return {};
  }
  return value as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim() === '') {
    throw new ProviderContractError(`MenetBrand info field '${key}' must be a non-empty string`);
  }
  return field;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field.trim() !== '' ? field : undefined;
}
