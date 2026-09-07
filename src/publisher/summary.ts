export interface PublisherRunSummary {
  readonly startTime: string;
  readonly endTime: string;
  readonly durationSeconds: number;
  readonly isDryRun: boolean;
  readonly feedsDiscoveredCount: number;
  readonly metadataCheckedCount: number;
  readonly unchangedCount: number;
  readonly downloadedCount: number;
  readonly publishedCount: number;
  readonly rejectedCount: number;
  readonly gatedCount: number;
  readonly menetbrandQuotaExhausted: boolean;
  readonly appReadyFeeds: string[];
  readonly rawMirrorFeeds: string[];
  readonly feedResults: Array<{
    readonly feedId: string;
    readonly status: string;
    readonly action: 'PUBLISHED' | 'RETAINED_LKG' | 'SKIPPED_UNCHANGED' | 'FAILED' | 'GATED_LICENSE';
    readonly message?: string;
    readonly sizeBytes?: number;
    readonly sha256?: string;
  }>;
  readonly totalStorageBytes: number;
  readonly totalStorageObjects: number;
}

export function formatStepSummaryMarkdown(summary: PublisherRunSummary): string {
  const szegedResult = summary.feedResults.find((f) => f.feedId === 'szeged');
  const budapestResult = summary.feedResults.find((f) => f.feedId === 'budapest');
  const mavResult = summary.feedResults.find((f) => f.feedId === 'mav-volan');

  const lines = [
    `# 🚀 Útirány Feed Publisher — Execution Report`,
    ``,
    `**Execution Mode:** ${summary.isDryRun ? '🟡 DRY RUN (No R2 writes)' : '🟢 PRODUCTION PUBLISH'}`,
    `**Duration:** ${summary.durationSeconds.toFixed(1)}s (${summary.startTime} → ${summary.endTime})`,
    ``,
  ];

  if (summary.menetbrandQuotaExhausted) {
    lines.push(
      `> [!WARNING]`,
      `> **MENETBRAND_QUOTA_EXHAUSTED:** Upstream MenetBrand API quota was reached during this execution. The circuit breaker activated immediately: 0 further MenetBrand calls were made, active LKGs were preserved, and independent providers (such as BKK) continued without interruption.`,
      ``,
    );
  }

  lines.push(
    `### Key Invariants & Status`,
    `- **Szeged Canonical (APP_READY):** ${szegedResult ? `${szegedResult.action} (${szegedResult.status})` : 'NOT_RUN'}`,
    `- **Budapest BKK (RAW_MIRROR):** ${budapestResult ? `${budapestResult.action} (${budapestResult.status})` : 'NOT_RUN'}`,
    `- **MÁV-Volán Nationwide (RAW_MIRROR):** ${mavResult ? `${mavResult.action} (${mavResult.status})` : 'NOT_RUN'}`,
    `- **R2 Bucket Usage:** ${(summary.totalStorageBytes / (1024 * 1024)).toFixed(2)} MiB across ${summary.totalStorageObjects} objects`,
    ``,
    `### Operations Summary`,
    `| Metric | Count |`,
    `|---|---|`,
    `| Feeds Discovered | ${summary.feedsDiscoveredCount} |`,
    `| Metadata Checked | ${summary.metadataCheckedCount} |`,
    `| Unchanged (Skipped Download) | ${summary.unchangedCount} |`,
    `| Downloaded Candidates | ${summary.downloadedCount} |`,
    `| Successfully Published | ${summary.publishedCount} |`,
    `| Validation / Catastrophe Rejections | ${summary.rejectedCount} |`,
    `| License Gated (Private/Unknown) | ${summary.gatedCount} |`,
    `| Total APP_READY Feeds | ${summary.appReadyFeeds.length} (${summary.appReadyFeeds.join(', ') || 'none'}) |`,
    `| Total RAW_MIRROR Feeds | ${summary.rawMirrorFeeds.length} |`,
    ``,
    `### Per-Feed Breakdown`,
    `| Feed ID | Status | Action | Size | Details |`,
    `|---|---|---|---|---|`,
  );

  for (const r of summary.feedResults) {
    const sizeStr = r.sizeBytes ? `${(r.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '-';
    lines.push(`| \`${r.feedId}\` | ${r.status} | ${r.action} | ${sizeStr} | ${r.message ?? 'OK'} |`);
  }

  lines.push('');
  lines.push(`*Generated autonomously by Útirány Nationwide Multi-Source Transit Data Platform*`);
  return lines.join('\n');
}
