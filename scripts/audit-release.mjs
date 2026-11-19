#!/usr/bin/env node
/**
 * Automated Open-Source Release Gate:
 * 1. Secret pattern scan (API keys, private keys, tokens)
 * 2. Private-ID / vendor-lock grep gate
 * 3. Transitive MIT license compatibility audit over package-lock.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'playwright-report', 'test-results']);

const SECRET_RULES = [
  { name: 'Google/Firebase API Key', re: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: 'OpenAI API Key', re: /\bsk-(?:proj-)?[0-9A-Za-z\-_]{20,}/g },
  { name: 'Stripe Key', re: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|\bwhsec_[0-9A-Za-z]{16,}/g },
  { name: 'Private Key PEM', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'GitHub Token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g },
  { name: 'Sentry DSN', re: /https:\/\/[a-f0-9]+@o\d+\.ingest(?:\.[a-z]+)?\.sentry\.io\/\d+/g },
];

const PRIVATE_ID_RULES = [
  { name: 'Private Firebase Project (nikola-eb245)', re: /nikola-eb245/gi },
  { name: 'Private Firebase Project (nikolarecipe-generator)', re: /nikolarecipe-generator/gi },
  { name: 'Private Cloud Run ID (tsearszfmq)', re: /tsearszfmq/gi },
  { name: 'Private Domain/Email (turwin.ai / paul.icon)', re: /turwin\.ai|paul\.icon@/gi },
  { name: 'Firebase SDK Import', re: /from\s+['"]firebase(?:\/|-admin|-functions)?/g },
];

const BLOCKED_LICENSE_RE = /\b(GPL|AGPL|LGPL|SSPL|BUSL|BSL|MPL|EPL|CDDL|CPAL|UNLICENSED|PROPRIETARY)\b/i;

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walkFiles(ROOT);
const secretFindings = [];
const privateIdFindings = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (rel === 'package-lock.json' || rel === 'scripts/audit-release.mjs') continue;
  const text = fs.readFileSync(file, 'utf8');

  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) {
      secretFindings.push({ file: rel, rule: rule.name });
    }
  }
  for (const rule of PRIVATE_ID_RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) {
      privateIdFindings.push({ file: rel, rule: rule.name });
    }
  }
}

const licenseBlockers = [];
let totalLockPackages = 0;
const lockPath = path.join(ROOT, 'package-lock.json');
if (!fs.existsSync(lockPath)) {
  licenseBlockers.push({ package: 'package-lock.json', license: 'LOCKFILE_MISSING' });
} else {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const pkgs = lock.packages || {};
  for (const [pkgPath, meta] of Object.entries(pkgs)) {
    if (!pkgPath) continue;
    totalLockPackages += 1;
    const lic = Array.isArray(meta.license) ? meta.license.join(' OR ') : String(meta.license || 'UNKNOWN');
    // Dual-licensed permissive OR copyleft (e.g. "MIT OR GPL-3.0") is acceptable under MIT;
    // flag any package that has NO permissive alternative.
    const hasPermissiveChoice = /\b(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|CC0-1\.0|BlueOak-1\.0\.0|Unlicense|AFL-2\.1)\b/i.test(lic);
    const isDualOr = /\bOR\b/.test(lic);
    if ((BLOCKED_LICENSE_RE.test(lic) && !(isDualOr && hasPermissiveChoice)) || lic === 'UNKNOWN') {
      licenseBlockers.push({ package: pkgPath, version: meta.version, license: lic });
    }
  }
}

const summary = {
  scannedFiles: files.length,
  totalLockPackages,
  secretFindings,
  privateIdFindings,
  licenseBlockers,
};

console.log(JSON.stringify(summary, null, 2));

if (secretFindings.length > 0 || privateIdFindings.length > 0 || licenseBlockers.length > 0) {
  console.error('\nRELEASE AUDIT FAILED.');
  process.exit(1);
}

console.log('\nRELEASE AUDIT PASSED: 0 secrets, 0 private IDs, 0 MIT license blockers.');
