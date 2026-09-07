import { loadConfig } from '../config/env.js';
import { SourceRegistry } from '../sources/registry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = SourceRegistry.createDefault();

  console.log('🔍 Útirány Multi-Source Transit Feed Discovery');
  console.log('--------------------------------------------------');

  const feeds = await registry.discoverAllFeeds();
  console.log(`Discovered ${feeds.length} transit feeds:\n`);

  console.log(
    '| Feed ID | Display Name | Region | Status | Preferred Provider | Authority Level | Redistribution |',
  );
  console.log(
    '|---|---|---|---|---|---|---|',
  );

  for (const f of feeds) {
    console.log(
      `| \`${f.feedId}\` | ${f.displayName} | ${f.region} | **${f.publicationStatus}** | ${f.preferredSource.provider} | ${f.preferredSource.authorityLevel} | ${f.preferredSource.redistributionPolicy} |`,
    );
  }

  console.log('\nDiscovery completed successfully.');
}

main().catch((err) => {
  console.error('Discovery error:', err);
  process.exit(1);
});
