import { readZipEntries } from './zip.js';

export interface GtfsMetrics {
  readonly stopCount: number;
  readonly routeCount: number;
  readonly tripCount: number;
  readonly stopTimeCount: number;
  readonly shapeCount: number;
  readonly serviceCount: number;
  readonly coverageStart: string | null;
  readonly coverageEnd: string | null;
  readonly agencyTimeZone: string | null;
}

export interface GtfsValidationResult {
  readonly isValid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
  readonly metrics: GtfsMetrics;
}

const REQUIRED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
];

const BOUNDS = {
  minLat: 45.0,
  maxLat: 49.0,
  minLon: 15.0,
  maxLon: 24.0,
};

export function validateGtfsPackage(
  filesOrZip: Record<string, string> | Map<string, string> | Buffer,
): GtfsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let files: Map<string, string>;
  if (Buffer.isBuffer(filesOrZip)) {
    try {
      files = readZipEntries(filesOrZip);
    } catch (e: any) {
      return {
        isValid: false,
        errors: [`Corrupted or invalid ZIP container: ${e.message}`],
        warnings: [],
        metrics: emptyMetrics(),
      };
    }
  } else if (filesOrZip instanceof Map) {
    files = filesOrZip;
  } else {
    files = new Map(Object.entries(filesOrZip));
  }

  // 1. Required files check
  for (const req of REQUIRED_FILES) {
    if (!files.has(req)) {
      errors.push(`Missing required GTFS file: ${req}`);
    }
  }

  const hasCalendar = files.has('calendar.txt');
  const hasCalendarDates = files.has('calendar_dates.txt');
  if (!hasCalendar && !hasCalendarDates) {
    errors.push('Feed must provide at least one of calendar.txt or calendar_dates.txt');
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, metrics: emptyMetrics() };
  }

  // 2. Parse agency.txt
  const agencyLines = parseCsv(files.get('agency.txt')!);
  if (agencyLines.rows.length === 0) {
    errors.push('agency.txt is empty');
  }
  const agencyTzIdx = agencyLines.headers.indexOf('agency_timezone');
  let agencyTimeZone: string | null = null;
  if (agencyTzIdx >= 0 && agencyLines.rows.length > 0) {
    agencyTimeZone = agencyLines.rows[0][agencyTzIdx]?.trim() || null;
  }
  if (!agencyTimeZone) {
    warnings.push('agency_timezone is missing or empty');
  }

  // 3. Parse stops.txt
  const stopsLines = parseCsv(files.get('stops.txt')!);
  const stopIdIdx = stopsLines.headers.indexOf('stop_id');
  const stopLatIdx = stopsLines.headers.indexOf('stop_lat');
  const stopLonIdx = stopsLines.headers.indexOf('stop_lon');

  if (stopIdIdx < 0) errors.push('stops.txt missing stop_id header');
  if (stopLatIdx < 0) errors.push('stops.txt missing stop_lat header');
  if (stopLonIdx < 0) errors.push('stops.txt missing stop_lon header');

  const stopIds = new Set<string>();
  let outOfBoundsStops = 0;
  for (const row of stopsLines.rows) {
    const id = row[stopIdIdx]?.trim();
    if (id) {
      if (stopIds.has(id)) {
        errors.push(`Duplicate stop_id in stops.txt: ${id}`);
      }
      stopIds.add(id);
    }
    const lat = Number(row[stopLatIdx]);
    const lon = Number(row[stopLonIdx]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLon || lon > BOUNDS.maxLon) {
        outOfBoundsStops++;
      }
    }
  }
  if (outOfBoundsStops > 0) {
    warnings.push(`${outOfBoundsStops} stops have coordinates outside Hungary standard bounds`);
  }
  if (stopIds.size === 0) {
    errors.push('stops.txt contains zero valid stops');
  }

  // 4. Parse routes.txt
  const routesLines = parseCsv(files.get('routes.txt')!);
  const routeIdIdx = routesLines.headers.indexOf('route_id');
  if (routeIdIdx < 0) errors.push('routes.txt missing route_id header');

  const routeIds = new Set<string>();
  for (const row of routesLines.rows) {
    const id = row[routeIdIdx]?.trim();
    if (id) {
      if (routeIds.has(id)) errors.push(`Duplicate route_id: ${id}`);
      routeIds.add(id);
    }
  }
  if (routeIds.size === 0) {
    errors.push('routes.txt contains zero valid routes');
  }

  // 5. Parse trips.txt
  const tripsLines = parseCsv(files.get('trips.txt')!);
  const tripIdIdx = tripsLines.headers.indexOf('trip_id');
  const tripRouteIdIdx = tripsLines.headers.indexOf('route_id');
  const tripServiceIdIdx = tripsLines.headers.indexOf('service_id');

  if (tripIdIdx < 0) errors.push('trips.txt missing trip_id header');
  if (tripRouteIdIdx < 0) errors.push('trips.txt missing route_id header');

  const tripIds = new Set<string>();
  const serviceIds = new Set<string>();
  for (const row of tripsLines.rows) {
    const id = row[tripIdIdx]?.trim();
    const routeId = row[tripRouteIdIdx]?.trim();
    const serviceId = tripServiceIdIdx >= 0 ? row[tripServiceIdIdx]?.trim() : '';

    if (id) {
      if (tripIds.has(id)) errors.push(`Duplicate trip_id: ${id}`);
      tripIds.add(id);
    }
    if (routeId && !routeIds.has(routeId)) {
      errors.push(`Trip '${id}' references unknown route_id '${routeId}'`);
    }
    if (serviceId) {
      serviceIds.add(serviceId);
    }
  }
  if (tripIds.size === 0) {
    errors.push('trips.txt contains zero valid trips');
  }

  // 6. Parse stop_times.txt
  const stopTimesLines = parseCsv(files.get('stop_times.txt')!);
  const stTripIdIdx = stopTimesLines.headers.indexOf('trip_id');
  const stStopIdIdx = stopTimesLines.headers.indexOf('stop_id');
  const stArrIdx = stopTimesLines.headers.indexOf('arrival_time');
  const stDepIdx = stopTimesLines.headers.indexOf('departure_time');

  if (stTripIdIdx < 0) errors.push('stop_times.txt missing trip_id header');
  if (stStopIdIdx < 0) errors.push('stop_times.txt missing stop_id header');

  let invalidTimeCount = 0;
  let unknownTripCount = 0;
  let unknownStopCount = 0;

  for (const row of stopTimesLines.rows) {
    const tripId = row[stTripIdIdx]?.trim();
    const stopId = row[stStopIdIdx]?.trim();
    const arr = stArrIdx >= 0 ? row[stArrIdx]?.trim() : '';
    const dep = stDepIdx >= 0 ? row[stDepIdx]?.trim() : '';

    if (tripId && !tripIds.has(tripId)) unknownTripCount++;
    if (stopId && !stopIds.has(stopId)) unknownStopCount++;

    if (arr && !isValidGtfsTime(arr)) invalidTimeCount++;
    if (dep && !isValidGtfsTime(dep)) invalidTimeCount++;
  }

  if (unknownTripCount > 0) {
    errors.push(`stop_times.txt has ${unknownTripCount} rows referencing unknown trips`);
  }
  if (unknownStopCount > 0) {
    errors.push(`stop_times.txt has ${unknownStopCount} rows referencing unknown stops`);
  }
  if (invalidTimeCount > 0) {
    errors.push(`stop_times.txt has ${invalidTimeCount} rows with unparseable arrival/departure times`);
  }
  if (stopTimesLines.rows.length === 0) {
    errors.push('stop_times.txt contains zero rows');
  }

  // 7. Parse calendar and dates coverage
  let minDate: string | null = null;
  let maxDate: string | null = null;

  if (hasCalendar) {
    const cal = parseCsv(files.get('calendar.txt')!);
    const startIdx = cal.headers.indexOf('start_date');
    const endIdx = cal.headers.indexOf('end_date');
    for (const row of cal.rows) {
      const s = row[startIdx]?.trim();
      const e = row[endIdx]?.trim();
      if (s && (!minDate || s < minDate)) minDate = s;
      if (e && (!maxDate || e > maxDate)) maxDate = e;
    }
  }

  if (hasCalendarDates) {
    const cd = parseCsv(files.get('calendar_dates.txt')!);
    const dateIdx = cd.headers.indexOf('date');
    for (const row of cd.rows) {
      const d = row[dateIdx]?.trim();
      if (d) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }
  }

  // 8. Shapes count
  let shapeCount = 0;
  if (files.has('shapes.txt')) {
    const shp = parseCsv(files.get('shapes.txt')!);
    const shpIdIdx = shp.headers.indexOf('shape_id');
    const uniqueShapes = new Set<string>();
    for (const row of shp.rows) {
      const id = row[shpIdIdx]?.trim();
      if (id) uniqueShapes.add(id);
    }
    shapeCount = uniqueShapes.size;
  }

  const metrics: GtfsMetrics = {
    stopCount: stopIds.size,
    routeCount: routeIds.size,
    tripCount: tripIds.size,
    stopTimeCount: stopTimesLines.rows.length,
    shapeCount,
    serviceCount: serviceIds.size,
    coverageStart: minDate ? formatIsoDate(minDate) : null,
    coverageEnd: maxDate ? formatIsoDate(maxDate) : null,
    agencyTimeZone,
  };

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}

export function isValidGtfsTime(timeStr: string): boolean {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(timeStr.trim());
  return match !== null;
}

function formatIsoDate(yyyymmdd: string): string {
  if (yyyymmdd.length === 8) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return yyyymmdd;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/);
  const rows: string[][] = [];
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (headers.length === 0) {
      headers = cols.map((h) => h.trim());
    } else {
      rows.push(cols);
    }
  }

  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function emptyMetrics(): GtfsMetrics {
  return {
    stopCount: 0,
    routeCount: 0,
    tripCount: 0,
    stopTimeCount: 0,
    shapeCount: 0,
    serviceCount: 0,
    coverageStart: null,
    coverageEnd: null,
    agencyTimeZone: null,
  };
}
