# Operational Runbook — Útirány Feed Publisher

Standard operating procedures for managing, troubleshooting, and verifying the nationwide feed publisher platform.

---

## 1. Manual GitHub Actions Execution

1. Navigate to the GitHub repository: `https://github.com/nagy-arnold/utirany-feed-publisher`
2. Go to **Actions** → **Publish Nationwide Transit Feeds**.
3. Click **Run workflow**:
   - `feed`: Leave empty or `all` to discover and update all feeds; or specify a single feed ID (e.g. `szeged` or `budapest`).
   - `dry_run`: Set to `true` to validate without writing to Cloudflare R2.
4. Inspect the resulting **Step Summary** for feed statistics, errors, and storage usage.

---

## 2. Inspecting R2 Objects via AWS CLI / S3

Using AWS CLI with Cloudflare R2 endpoint:
```bash
export AWS_ACCESS_KEY_ID="<R2_ACCESS_KEY_ID>"
export AWS_SECRET_ACCESS_KEY="<R2_SECRET_ACCESS_KEY>"
export AWS_ENDPOINT_URL="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"

# List published catalog and manifests
aws s3 ls s3://utirany-transit-feeds/v1/ --recursive

# Inspect Szeged manifest
aws s3 cp s3://utirany-transit-feeds/v1/feeds/szeged/manifest.json -
```

---

## 3. Verifying Public HTTPS Gateway

```bash
# 1. Health check
curl -i https://utirany-feed.tir-ny.workers.dev/

# 2. Fetch Catalog
curl -s https://utirany-feed.tir-ny.workers.dev/v1/catalog.json | jq .

# 3. Fetch Szeged Manifest
curl -s https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/manifest.json | jq .

# 4. Verify ETag & 304 Not Modified
ETAG=$(curl -sI https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/manifest.json | grep -i etag | tr -d '\r\n' | awk '{print $2}')
curl -i -H "If-None-Match: $ETAG" https://utirany-feed.tir-ny.workers.dev/v1/feeds/szeged/manifest.json
# Expect: HTTP/2 304 Not Modified
```

---

## 4. Rollback to Previous Feed Version

The publisher automatically retains the previous LKG artifact alongside the active one.
If a newly published feed exhibits an unexpected operational problem:

1. List available artifacts for the feed in R2:
   ```bash
   aws s3 ls s3://utirany-transit-feeds/v1/feeds/<feedId>/artifacts/
   ```
2. Identify the previous artifact SHA-256.
3. Update `manifest.json` on R2 to point `sha256`, `contentSha256`, and `downloadUrl` back to the previous artifact.
4. Clients fetching `manifest.json` will immediately detect the generation change and download the rolled-back artifact.

---

## 5. Credential Rotation

### MenetBrand API Key
1. Obtain the new key from MenetBrand.
2. In GitHub repository: **Settings** → **Secrets and variables** → **Actions** → update `MENETBRAND_API_KEY`.
3. Trigger a manual workflow test run.

### Cloudflare R2 Credentials
1. In Cloudflare Dashboard: **R2** → **Manage R2 API Tokens** → Create new API Token (Object Read & Write).
2. Update GitHub Secrets: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
3. Update `R2_ACCOUNT_ID` variable if the Cloudflare account changed.
4. Revoke old token in Cloudflare Dashboard after confirming successful workflow run.

---

## 6. Outage & Quota Incident Response

### MenetBrand Quota Exhausted (`ERROR_API_KEY_LIMIT_REACHED`)
- **Symptom:** Workflow logs show `QuotaExhaustedError`.
- **System Behavior:** Automatic protection is triggered. The publisher logs the quota event, skips further MenetBrand downloads, and **preserves all existing LKG manifests and artifacts** on R2.
- **Action:** No emergency action required; feeds remain online. Quota resets daily at 00:00 UTC.

### Cloudflare R2 / Worker Outage
- Android clients catch network exceptions and stay on their local Room database without crashing.
