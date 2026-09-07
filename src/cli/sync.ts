import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config/env.js';
import { PublisherEngine } from '../publisher/engine.js';
import { formatStepSummaryMarkdown } from '../publisher/summary.js';
import { SourceRegistry } from '../sources/registry.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dryRun = args.includes('--dry-run');
  let targetFeedId: string | undefined = undefined;
  let seedPath: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--feed' && args[i + 1]) {
      targetFeedId = args[i + 1];
      i++;
    }
    if (args[i] === '--seed-szeged' && args[i + 1]) {
      seedPath = args[i + 1];
      i++;
    }
  }

  const config = loadConfig();
  if (config.isDryRun) dryRun = true;

  console.log('🚀 Útirány Nationwide Multi-Source Transit Feed Publisher');
  console.log('========================================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no R2 mutations)' : 'PRODUCTION'}`);
  console.log(`Target: ${targetFeedId ?? 'ALL FEEDS'}`);
  console.log(`Public Base URL: ${config.publicFeedBaseUrl}`);
  console.log(`R2 Bucket: ${config.r2BucketName} (configured: ${config.hasR2Credentials})`);

  let seededFeedFiles: Map<string, string> | undefined = undefined;
  // If seed path provided or local default available
  const defaultAssetSeed = resolve('C:/AG/Menetrend_New/data/src/main/assets/gtfs');
  const candidateSeedPath = seedPath ? resolve(seedPath) : existsSync(defaultAssetSeed) ? defaultAssetSeed : undefined;

  if (candidateSeedPath && existsSync(candidateSeedPath)) {
    console.log(`Loading canonical seed dataset from: ${candidateSeedPath}`);
    seededFeedFiles = new Map<string, string>();
    for (const f of readdirSync(candidateSeedPath)) {
      if (f.endsWith('.txt') || f.endsWith('.json')) {
        seededFeedFiles.set(f, readFileSync(resolve(candidateSeedPath, f), 'utf8'));
      }
    }
    console.log(`Seeded ${seededFeedFiles.size} canonical GTFS files.`);
  }

  const registry = SourceRegistry.createDefault();
  const engine = new PublisherEngine(config, registry);

  const summary = await engine.run({
    dryRun,
    targetFeedId,
    seededFeedFiles,
  });

  const markdownSummary = formatStepSummaryMarkdown(summary);
  console.log('\n' + markdownSummary);

  // Write to GitHub Actions Step Summary if available
  const githubStepSummaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (githubStepSummaryFile) {
    try {
      appendFileSync(githubStepSummaryFile, markdownSummary + '\n', 'utf8');
      console.log('Successfully wrote Step Summary to $GITHUB_STEP_SUMMARY');
    } catch (err) {
      console.error('Failed to write Step Summary to $GITHUB_STEP_SUMMARY:', err);
    }
  }

  // Check for critical failures: Szeged must not fail
  const szegedResult = summary.feedResults.find((f) => f.feedId === 'szeged');
  if (szegedResult && szegedResult.action === 'FAILED') {
    console.error('❌ Critical failure: Szeged publication failed!');
    process.exit(1);
  }

  console.log('Sync finished successfully.');
}

main().catch((err) => {
  console.error('Fatal publisher sync error:', err);
  process.exit(1);
});
