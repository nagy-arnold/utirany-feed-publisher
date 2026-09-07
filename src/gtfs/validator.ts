import AdmZip from 'adm-zip';

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

interface GtfsAccessor {
  has(filename: string): boolean;
  get(filename: string): string | null;
}

export function validateGtfsPackage(
  filesOrZip: Record<string, string> | Map<string, string> | Buffer,
): GtfsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let accessor: GtfsAccessor;

  if (Buffer.isBuffer(filesOrZip)) {
    try {
      const zip = new AdmZip(filesOrZip);
      const entries = zip.getEntries();
      const entryMap = new Map<string, any>();
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const normName = entry.entryName.replace(/^.*[\\\/]/, '');
          if (normName) entryMap.set(normName, entry);
        }
      }
      accessor = {
        has: (filename: string) => entryMap.has(filename),
        get: (filename: string) => {
          const entry = entryMap.get(filename);
          return entry ? entry.getData().toString('utf8') : null;
        },
      };
    } catch (e: any) {
      return {
        isValid: false,
        errors: [`Corrupted or invalid ZIP container: ${e.message}`],
        warnings: [],
        metrics: emptyMetrics(),
      };
    }
  } else if (filesOrZip instanceof Map) {
    accessor = {
      has: (filename: string) => filesOrZip.has(filename),
      get: (filename: string) => filesOrZip.get(filename) ?? null,
    };
  } else {
    accessor = {
      has: (filename: string) => Object.prototype.hasOwnProperty.call(filesOrZip, filename),
      get: (filename: string) => (filesOrZip as Record<string, string>)[filename] ?? null,
    };
  }

  // 1. Required files check
  for (const req of REQUIRED_FILES) {
    if (!accessor.has(req)) {
      errors.push(`Missing required GTFS file: ${req}`);
    }
  }

  const hasCalendar = accessor.has('calendar.txt');
  const hasCalendarDates = accessor.has('calendar_dates.txt');
  if (!hasCalendar && !hasCalendarDates) {
    errors.push('Feed must provide at least one of calendar.txt or calendar_dates.txt');
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, metrics: emptyMetrics() };
  }

  // 2. Parse agency.txt
  let agencyTimeZone: string | null = null;
  let agencyTzIdx = -1;
  const agencyText = accessor.get('agency.txt')!;
  const agencyRes = forEachCsvLine(agencyText, (row, _, headers) => {
    if (agencyTzIdx < 0) {
      agencyTzIdx = headers.indexOf('agency_timezone');
    }
    if (agencyTzIdx >= 0 && !agencyTimeZone) {
      agencyTimeZone = row[agencyTzIdx]?.trim() || null;
    }
  });

  if (agencyRes.totalRows === 0) {
    errors.push('agency.txt is empty');
  }
  if (!agencyTimeZone) {
    warnings.push('agency_timezone is missing or empty');
  }

  // 3. Parse stops.txt
  const stopsText = accessor.get('stops.txt')!;
  let stopIdIdx = -1;
  let stopLatIdx = -1;
  let stopLonIdx = -1;
  const stopIds = new Set<string>();
  let outOfBoundsStops = 0;

  const stopsRes = forEachCsvLine(stopsText, (row, _, headers) => {
    if (stopIdIdx < 0) {
      stopIdIdx = headers.indexOf('stop_id');
      stopLatIdx = headers.indexOf('stop_lat');
      stopLonIdx = headers.indexOf('stop_lon');
    }

    const id = stopIdIdx >= 0 ? row[stopIdIdx]?.trim() : '';
    if (id) {
      if (stopIds.has(id)) {
        errors.push(`Duplicate stop_id in stops.txt: ${id}`);
      }
      stopIds.add(id);
    }

    const lat = stopLatIdx >= 0 ? Number(row[stopLatIdx]) : NaN;
    const lon = stopLonIdx >= 0 ? Number(row[stopLonIdx]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLon || lon > BOUNDS.maxLon) {
        outOfBoundsStops++;
      }
    }
  });

  if (stopsRes.headers.indexOf('stop_id') < 0) errors.push('stops.txt missing stop_id header');
  if (stopsRes.headers.indexOf('stop_lat') < 0) errors.push('stops.txt missing stop_lat header');
  if (stopsRes.headers.indexOf('stop_lon') < 0) errors.push('stops.txt missing stop_lon header');

  if (outOfBoundsStops > 0) {
    warnings.push(`${outOfBoundsStops} stops have coordinates outside Hungary standard bounds`);
  }
  if (stopIds.size === 0) {
    errors.push('stops.txt contains zero valid stops');
  }

  // 4. Parse routes.txt
  const routesText = accessor.get('routes.txt')!;
  let routeIdIdx = -1;
  const routeIds = new Set<string>();

  const routesRes = forEachCsvLine(routesText, (row, _, headers) => {
    if (routeIdIdx < 0) {
      routeIdIdx = headers.indexOf('route_id');
    }
    const id = routeIdIdx >= 0 ? row[routeIdIdx]?.trim() : '';
    if (id) {
      if (routeIds.has(id)) errors.push(`Duplicate route_id: ${id}`);
      routeIds.add(id);
    }
  });

  if (routesRes.headers.indexOf('route_id') < 0) errors.push('routes.txt missing route_id header');
  if (routeIds.size === 0) {
    errors.push('routes.txt contains zero valid routes');
  }

  // 5. Parse trips.txt
  const tripsText = accessor.get('trips.txt')!;
  let tripIdIdx = -1;
  let tripRouteIdIdx = -1;
  let tripServiceIdIdx = -1;
  const tripIds = new Set<string>();
  const serviceIds = new Set<string>();

  const tripsRes = forEachCsvLine(tripsText, (row, _, headers) => {
    if (tripIdIdx < 0) {
      tripIdIdx = headers.indexOf('trip_id');
      tripRouteIdIdx = headers.indexOf('route_id');
      tripServiceIdIdx = headers.indexOf('service_id');
    }
    const id = tripIdIdx >= 0 ? row[tripIdIdx]?.trim() : '';
    const routeId = tripRouteIdIdx >= 0 ? row[tripRouteIdIdx]?.trim() : '';
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
  });

  if (tripsRes.headers.indexOf('trip_id') < 0) errors.push('trips.txt missing trip_id header');
  if (tripsRes.headers.indexOf('route_id') < 0) errors.push('trips.txt missing route_id header');
  if (tripIds.size === 0) {
    errors.push('trips.txt contains zero valid trips');
  }

  // 6. Parse stop_times.txt (Streaming line by line to support 100MB+ files without OOM)
  const stopTimesText = accessor.get('stop_times.txt')!;
  let stTripIdIdx = -1;
  let stStopIdIdx = -1;
  let stArrIdx = -1;
  let stDepIdx = -1;

  let invalidTimeCount = 0;
  let unknownTripCount = 0;
  let unknownStopCount = 0;

  const stRes = forEachCsvLine(stopTimesText, (row, _, headers) => {
    if (stTripIdIdx < 0) {
      stTripIdIdx = headers.indexOf('trip_id');
      stStopIdIdx = headers.indexOf('stop_id');
      stArrIdx = headers.indexOf('arrival_time');
      stDepIdx = headers.indexOf('departure_time');
    }

    const tripId = stTripIdIdx >= 0 ? row[stTripIdIdx]?.trim() : '';
    const stopId = stStopIdIdx >= 0 ? row[stStopIdIdx]?.trim() : '';
    const arr = stArrIdx >= 0 ? row[stArrIdx]?.trim() : '';
    const dep = stDepIdx >= 0 ? row[stDepIdx]?.trim() : '';

    if (tripId && !tripIds.has(tripId)) unknownTripCount++;
    if (stopId && !stopIds.has(stopId)) unknownStopCount++;

    if (arr && !isValidGtfsTime(arr)) invalidTimeCount++;
    if (dep && !isValidGtfsTime(dep)) invalidTimeCount++;
  });

  if (stRes.headers.indexOf('trip_id') < 0) errors.push('stop_times.txt missing trip_id header');
  if (stRes.headers.indexOf('stop_id') < 0) errors.push('stop_times.txt missing stop_id header');
  if (stRes.totalRows === 0) {
    errors.push('stop_times.txt contains zero rows');
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

  // 7. Parse calendar and dates coverage
  let minDate: string | null = null;
  let maxDate: string | null = null;

  if (hasCalendar) {
    const calText = accessor.get('calendar.txt')!;
    let startIdx = -1;
    let endIdx = -1;
    forEachCsvLine(calText, (row, _, headers) => {
      if (startIdx < 0) {
        startIdx = headers.indexOf('start_date');
        endIdx = headers.indexOf('end_date');
      }
      const s = startIdx >= 0 ? row[startIdx]?.trim() : '';
      const e = endIdx >= 0 ? row[endIdx]?.trim() : '';
      if (s && (!minDate || s < minDate)) minDate = s;
      if (e && (!maxDate || e > maxDate)) maxDate = e;
    });
  }

  if (hasCalendarDates) {
    const cdText = accessor.get('calendar_dates.txt')!;
    let dateIdx = -1;
    forEachCsvLine(cdText, (row, _, headers) => {
      if (dateIdx < 0) {
        dateIdx = headers.indexOf('date');
      }
      const d = dateIdx >= 0 ? row[dateIdx]?.trim() : '';
      if (d) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    });
  }

  // 8. Shapes count
  let shapeCount = 0;
  if (accessor.has('shapes.txt')) {
    const shapesText = accessor.get('shapes.txt')!;
    let shpIdIdx = -1;
    const uniqueShapes = new Set<string>();
    forEachCsvLine(shapesText, (row, _, headers) => {
      if (shpIdIdx < 0) {
        shpIdIdx = headers.indexOf('shape_id');
      }
      const id = shpIdIdx >= 0 ? row[shpIdIdx]?.trim() : '';
      if (id) uniqueShapes.add(id);
    });
    shapeCount = uniqueShapes.size;
  }

  const metrics: GtfsMetrics = {
    stopCount: stopIds.size,
    routeCount: routeIds.size,
    tripCount: tripIds.size,
    stopTimeCount: stRes.totalRows,
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

export function forEachCsvLine(
  content: string,
  onRow: (cols: string[], rowIndex: number, headers: string[]) => boolean | void,
): { headers: string[]; totalRows: number } {
  let lineStart = 0;
  let headers: string[] = [];
  let rowIndex = 0;
  const len = content.length;

  while (lineStart < len) {
    let lineEnd = content.indexOf('\n', lineStart);
    if (lineEnd === -1) {
      lineEnd = len;
    }
    let line = content.slice(lineStart, lineEnd);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    line = line.trim();

    if (line.length > 0) {
      const cols = line.includes('"') ? splitCsvLine(line) : line.split(',');
      if (headers.length === 0) {
        headers = cols.map((h) => h.trim());
      } else {
        const keepGoing = onRow(cols, rowIndex++, headers);
        if (keepGoing === false) {
          break;
        }
      }
    }

    lineStart = lineEnd + 1;
  }

  return { headers, totalRows: rowIndex };
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
