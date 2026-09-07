import { CanonicalRegistry } from './registry.js';

export function canonicalizeGtfsFiles(
  files: Record<string, string> | Map<string, string>,
  registry: CanonicalRegistry,
  sourceNamespace: string = 'MENETBRAND_SZEGED',
): {
  files: Map<string, string>;
  canonicalStopsCount: number;
} {
  const fileMap = files instanceof Map ? new Map(files) : new Map(Object.entries(files));

  const stopsText = fileMap.get('stops.txt');
  const stopTimesText = fileMap.get('stop_times.txt');

  if (!stopsText || !stopTimesText) {
    throw new Error('Canonicalization requires stops.txt and stop_times.txt');
  }

  // 1. Rewrite stops.txt
  const stopLines = stopsText.split(/\r?\n/);
  const stopHeader = stopLines[0];
  const stopIdIdx = getHeaderIndex(stopHeader, 'stop_id');
  if (stopIdIdx < 0) throw new Error('stops.txt missing stop_id header');

  const rewrittenStops = [stopHeader];
  const stopMapping = new Map<string, string>();

  for (let i = 1; i < stopLines.length; i++) {
    const line = stopLines[i].trim();
    if (!line) continue;
    const cols = splitCsv(line);
    const rawId = cols[stopIdIdx];

    let canonicalId = rawId.startsWith('utirany:physical_stop:') ? rawId : undefined;
    if (!canonicalId) {
      canonicalId = registry.getCanonicalStopId(sourceNamespace, rawId);
    }

    if (!canonicalId) {
      throw new Error(`Stop '${rawId}' has no canonical identity in registry namespace '${sourceNamespace}'`);
    }

    stopMapping.set(rawId, canonicalId);
    cols[stopIdIdx] = canonicalId;
    rewrittenStops.push(joinCsv(cols));
  }

  // 2. Rewrite stop_times.txt
  const stLines = stopTimesText.split(/\r?\n/);
  const stHeader = stLines[0];
  const stStopIdIdx = getHeaderIndex(stHeader, 'stop_id');
  if (stStopIdIdx < 0) throw new Error('stop_times.txt missing stop_id header');

  const rewrittenStopTimes = [stHeader];
  for (let i = 1; i < stLines.length; i++) {
    const line = stLines[i].trim();
    if (!line) continue;
    const cols = splitCsv(line);
    const rawId = cols[stStopIdIdx];

    let canonicalId = rawId.startsWith('utirany:physical_stop:') ? rawId : stopMapping.get(rawId);
    if (!canonicalId) {
      canonicalId = registry.getCanonicalStopId(sourceNamespace, rawId);
    }

    if (!canonicalId) {
      throw new Error(`stop_times.txt references unmapped stop '${rawId}'`);
    }

    cols[stStopIdIdx] = canonicalId;
    rewrittenStopTimes.push(joinCsv(cols));
  }

  fileMap.set('stops.txt', rewrittenStops.join('\n') + '\n');
  fileMap.set('stop_times.txt', rewrittenStopTimes.join('\n') + '\n');

  return {
    files: fileMap,
    canonicalStopsCount: stopMapping.size,
  };
}

function getHeaderIndex(header: string, name: string): number {
  const cols = splitCsv(header);
  return cols.findIndex((c) => c.trim().toLowerCase() === name.toLowerCase());
}

function splitCsv(line: string): string[] {
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

function joinCsv(cols: string[]): string {
  return cols
    .map((value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
    .join(',');
}
