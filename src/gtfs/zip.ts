import AdmZip from 'adm-zip';

export function readZipEntries(zipBuffer: Buffer): Map<string, string> {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const result = new Map<string, string>();

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    // Normalize path (strip any leading directory or slashes)
    const name = entry.entryName.replace(/^.*[\\\/]/, '');
    if (!name) continue;
    result.set(name, entry.getData().toString('utf8'));
  }

  return result;
}

export function readZipBinaryEntries(zipBuffer: Buffer): Map<string, Buffer> {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const result = new Map<string, Buffer>();

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/^.*[\\\/]/, '');
    if (!name) continue;
    result.set(name, entry.getData());
  }

  return result;
}

export function createZip(entries: Map<string, string | Buffer> | Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries));

  // Sort entry names for determinism
  const sortedNames = Array.from(map.keys()).sort();

  for (const name of sortedNames) {
    const data = map.get(name)!;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    zip.addFile(name, buffer);
  }

  return zip.toBuffer();
}
