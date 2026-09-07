import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function exportMenetBrandDatabaseToGtfs(
  databasePathOrBuffer: string | Buffer,
): Record<string, string> {
  let dbPath: string;
  let tempFileCreated = false;

  if (typeof databasePathOrBuffer === 'string') {
    dbPath = databasePathOrBuffer;
  } else {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-db-'));
    dbPath = path.join(tmpDir, 'gtfs.db');
    fs.writeFileSync(dbPath, databasePathOrBuffer);
    tempFileCreated = true;
  }

  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const agencies = all(database, 'SELECT id, name, url, timezone, lang, phone FROM agency ORDER BY id');
    const agencyById = new Map<number, { id: number; name: string; url: string | null; timezone: string; lang: string | null; phone: string | null }>();
    for (const row of agencies) {
      agencyById.set(num(row.id), {
        id: num(row.id),
        name: str(row.name),
        url: nullableStr(row.url),
        timezone: str(row.timezone),
        lang: nullableStr(row.lang),
        phone: nullableStr(row.phone),
      });
    }

    const routes = all(database, `
      SELECT r.key, r.id, r.agency_id, r.short_name, r.long_name, r.type_vehicle, r.color, r.text_color,
             (SELECT COUNT(*) FROM trip t WHERE t.route_key = r.key) AS trip_count
      FROM route r ORDER BY r.key
    `).filter((row) => num(row.trip_count) > 0);

    const stops = all(database, `
      SELECT s.key, s.id, s.latitude, s.longitude, i.name
      FROM stop s JOIN stop_info i ON i.id = s.info_id ORDER BY s.key
    `);

    const calendarRanges = all(database, 'SELECT service_id, date_from, date_to FROM calendar_date_range ORDER BY service_id, date_from');
    const calendarDates = all(database, 'SELECT service_id, date, exception_type FROM calendar_date ORDER BY service_id, date');
    const shapes = all(database, 'SELECT shape_id, polyline FROM shape_compat ORDER BY shape_id');

    const stopSetStops = new Map<string, Array<{ stopKey: number; sequence: number }>>();
    for (const row of all(database, `
      SELECT ssf.route_key, ssf.id, ssf.stop_key, ssf.sequence
      FROM stop_set_full ssf ORDER BY ssf.route_key, ssf.id, ssf.sequence
    `)) {
      const key = `${num(row.route_key)}:${num(row.id)}`;
      const list = stopSetStops.get(key) ?? [];
      list.push({ stopKey: num(row.stop_key), sequence: num(row.sequence) });
      stopSetStops.set(key, list);
    }

    const deltas = new Map<string, { arr: number; dep: number }>();
    for (const row of all(database, 'SELECT id, stop_sequence, arr_elapsed_by_initial, dep_elapsed_by_initial FROM trip_delta_times')) {
      deltas.set(`${num(row.id)}:${num(row.stop_sequence)}`, {
        arr: num(row.arr_elapsed_by_initial),
        dep: num(row.dep_elapsed_by_initial),
      });
    }

    const tripRows = all(database, `
      SELECT t.id, t.route_key, t.stop_set_id, t.service_id, t.delta_time_id, t.shape_id,
             d.direction_id AS direction_id,
             arrival.initial_time AS initial_arrival, departure.initial_time AS initial_departure,
             h.headsign
      FROM trip t
      JOIN trip_initial_times arrival ON arrival.id = t.initial_arr_time_id
      JOIN trip_initial_times departure ON departure.id = t.initial_dep_time_id
      LEFT JOIN direction d ON d.route_key = t.route_key AND d.stop_set_id = t.stop_set_id
      LEFT JOIN trip_headsigns h ON h.id = t.headsign_id
      ORDER BY t.id
    `);

    const agencyLines = ['agency_id,agency_name,agency_url,agency_timezone,agency_phone,agency_lang'];
    for (const a of agencyById.values()) {
      agencyLines.push(csv([String(a.id), a.name, a.url ?? '', a.timezone, a.phone ?? '', a.lang ?? '']));
    }

    const routeLines = ['route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color'];
    for (const r of routes) {
      const type = gtfsRouteType(num(r.type_vehicle));
      routeLines.push(csv([
        str(r.id),
        String(num(r.agency_id)),
        nullableStr(r.short_name) ?? '',
        nullableStr(r.long_name) ?? '',
        String(type),
        nullableStr(r.color) ?? '',
        nullableStr(r.text_color) ?? '',
      ]));
    }

    const stopLines = ['stop_id,stop_name,stop_lat,stop_lon'];
    for (const s of stops) {
      stopLines.push(csv([str(s.id), str(s.name), fmtCoord(num(s.latitude)), fmtCoord(num(s.longitude))]));
    }

    const stopById = new Map<number, string>();
    for (const s of stops) stopById.set(num(s.key), str(s.id));

    const tripLines = ['trip_id,route_id,service_id,trip_headsign,direction_id,shape_id'];
    const stopTimeLines = ['trip_id,stop_sequence,stop_id,arrival_time,departure_time'];

    const routeKeyToRouteId = new Map<number, string>();
    for (const r of routes) routeKeyToRouteId.set(num(r.key), str(r.id));

    for (const t of tripRows) {
      const routeId = routeKeyToRouteId.get(num(t.route_key));
      const stopSetKey = `${num(t.route_key)}:${num(t.stop_set_id)}`;
      const seq = stopSetStops.get(stopSetKey);
      if (!routeId || !seq || seq.length === 0) continue;

      const shapeId = t.shape_id === null || t.shape_id === undefined ? null : String(t.shape_id);
      const headsign = nullableStr(t.headsign);
      const directionId = nullableStr(t.direction_id);
      const serviceId = str(t.service_id);
      const initialArr = parseGtfsTimeSeconds(str(t.initial_arrival));
      const initialDep = parseGtfsTimeSeconds(str(t.initial_departure));
      if (initialArr === null || initialDep === null) continue;

      const tripId = str(t.id);
      tripLines.push(csv([tripId, routeId, serviceId, headsign ?? '', directionId ?? '', shapeId ?? '']));
      const deltaId = num(t.delta_time_id);
      let wroteAny = false;

      for (const stop of seq) {
        const delta = deltas.get(`${deltaId}:${stop.sequence}`);
        if (!delta) continue;
        const arrivalSeconds = initialArr + delta.arr * 60;
        const departureSeconds = initialDep + delta.dep * 60;
        const stopId = stopById.get(stop.stopKey);
        if (!stopId) continue;
        if (arrivalSeconds < 0 || departureSeconds < 0) continue;
        stopTimeLines.push(csv([
          tripId,
          String(stop.sequence),
          stopId,
          formatGtfsTime(arrivalSeconds),
          formatGtfsTime(departureSeconds),
        ]));
        wroteAny = true;
      }
      if (!wroteAny) {
        tripLines.pop();
      }
    }

    const calendarLines = ['service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date'];
    for (const range of calendarRanges) {
      const start = String(num(range.date_from));
      const end = String(num(range.date_to));
      calendarLines.push(csv([str(range.service_id), '1', '1', '1', '1', '1', '1', '1', start, end]));
    }

    const calendarDatesLines = ['service_id,date,exception_type'];
    for (const cd of calendarDates) {
      calendarDatesLines.push(csv([str(cd.service_id), String(num(cd.date)), String(num(cd.exception_type))]));
    }

    const shapeLines = ['shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence'];
    for (const shape of shapes) {
      const points = decodePolyline(str(shape.polyline));
      points.forEach((point, index) => {
        shapeLines.push(csv([String(num(shape.shape_id)), fmtCoord(point.latitude), fmtCoord(point.longitude), String(index + 1)]));
      });
    }

    const meta = new Map<string, string>(
      all(database, 'SELECT key, value FROM app_meta').map((row) => [str(row.key), str(row.value)]),
    );
    const created = meta.get('created_date_time') ?? '';
    const minDate = calendarRanges.length > 0 ? String(Math.min(...calendarRanges.map((r) => num(r.date_from)))) : '';
    const maxDate = calendarRanges.length > 0 ? String(Math.max(...calendarRanges.map((r) => num(r.date_to)))) : '';
    const feedInfoLines = [
      'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version',
      csv(['Útirány GTFS publisher', 'https://utirany.app', 'hu', minDate, maxDate, `utirany-${created.replace(/[^0-9]/g, '').slice(0, 14)}`]),
    ];

    return {
      'agency.txt': agencyLines.join('\n') + '\n',
      'routes.txt': routeLines.join('\n') + '\n',
      'stops.txt': stopLines.join('\n') + '\n',
      'trips.txt': tripLines.join('\n') + '\n',
      'stop_times.txt': stopTimeLines.join('\n') + '\n',
      'calendar.txt': calendarLines.join('\n') + '\n',
      'calendar_dates.txt': calendarDatesLines.join('\n') + '\n',
      'shapes.txt': shapeLines.join('\n') + '\n',
      'feed_info.txt': feedInfoLines.join('\n') + '\n',
    };
  } finally {
    database.close();
    if (tempFileCreated) {
      try {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      } catch {}
    }
  }
}

function gtfsRouteType(typeVehicle: number): number {
  if (typeVehicle === 901) return 0; // tram
  if (typeVehicle === 800) return 11; // trolley
  if (typeVehicle === 100 || typeVehicle === 102) return 2; // rail
  return 3; // bus
}

export function parseGtfsTimeSeconds(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return null;
  const hours = parts[0];
  const minutes = parts[1];
  const seconds = parts[2] ?? 0;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatGtfsTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    } while (true);
    const latDelta = result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    } while (true);
    const lonDelta = result & 1 ? ~(result >> 1) : result >> 1;
    latitude += latDelta;
    longitude += lonDelta;
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

function csv(values: Array<string | number>): string {
  return values.map((value) => {
    const raw = String(value);
    return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  }).join(',');
}

function fmtCoord(value: number): string {
  return value.toFixed(6);
}

function all(database: DatabaseSync, sql: string): Array<Record<string, unknown>> {
  return database.prepare(sql).all() as Array<Record<string, unknown>>;
}

function num(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Expected numeric value, received '${String(value)}'`);
  return result;
}

function str(value: unknown): string {
  return String(value);
}

function nullableStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result === '' ? null : result;
}
