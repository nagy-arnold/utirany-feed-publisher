import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGtfsPackage } from '../gtfs/validator.js';

async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error('Usage: npm run validate <path-to-gtfs-zip>');
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Validating GTFS package: ${fullPath}`);
  const bytes = readFileSync(fullPath);
  const result = validateGtfsPackage(bytes);

  console.log('\nValidation Result:');
  console.log(`  Valid: ${result.isValid ? '✅ YES' : '❌ NO'}`);
  console.log('  Metrics:');
  console.log(`    Stops: ${result.metrics.stopCount}`);
  console.log(`    Routes: ${result.metrics.routeCount}`);
  console.log(`    Trips: ${result.metrics.tripCount}`);
  console.log(`    Stop times: ${result.metrics.stopTimeCount}`);
  console.log(`    Shapes: ${result.metrics.shapeCount}`);
  console.log(`    Coverage: ${result.metrics.coverageStart} → ${result.metrics.coverageEnd}`);
  console.log(`    Timezone: ${result.metrics.agencyTimeZone}`);

  if (result.warnings.length > 0) {
    console.log('\n  ⚠️ Warnings:');
    result.warnings.forEach((w) => console.log(`    - ${w}`));
  }

  if (result.errors.length > 0) {
    console.log('\n  ❌ Errors:');
    result.errors.forEach((e) => console.log(`    - ${e}`));
    process.exit(1);
  }

  console.log('\nPackage passed validation.');
}

main().catch((err) => {
  console.error('Validation error:', err);
  process.exit(1);
});
