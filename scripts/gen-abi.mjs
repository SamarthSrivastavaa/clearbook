/**
 * Regenerates frontend/lib/abi.ts from the compiled Foundry artifacts.
 *
 * The frontend must never carry a hand-transcribed ABI: a single wrong type
 * silently breaks decoding, and custom-error decoding in particular is what
 * stands between a judge and a raw revert blob.
 *
 *   node scripts/gen-abi.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Keeps every error and event, plus the named functions the UI actually calls. */
function pick(name, keepFunctions) {
  const artifact = JSON.parse(readFileSync(`${ROOT}/contracts/out/${name}.sol/${name}.json`, 'utf8'));
  return artifact.abi.filter(
    (e) =>
      e.type === 'error' ||
      e.type === 'event' ||
      (e.type === 'function' && keepFunctions.includes(e.name)),
  );
}

const clearbook = pick('Clearbook', [
  'loans',
  'originators',
  'nextLoanId',
  'nextOriginatorId',
  'treasuryOwner',
  'factConsumedBy',
  'BOND_PER_LOAN',
  'SLASH_BPS',
  'BOUNTY_BPS',
  'REPAYMENT_BPS',
  'WITHDRAW_COOLDOWN',
  'PROTOCOL_SINK',
  'VAULT',
  'challenge',
  'finalize',
  'markDelinquent',
]);

const vault = pick('EvidenceVault', [
  'getFact',
  'exists',
  'computeFactId',
  'ERC20_TRANSFER_TOPIC',
  'VERIFIER',
  'MAX_BATCH_SIZE',
  'MAX_BATCH_RANGE',
  'submitTransferFact',
]);

const out =
  '// GENERATED from contracts/out/*.json — do not edit by hand.\n' +
  '// Regenerate: node scripts/gen-abi.mjs\n\n' +
  `export const clearbookAbi = ${JSON.stringify(clearbook, null, 2)} as const;\n\n` +
  `export const evidenceVaultAbi = ${JSON.stringify(vault, null, 2)} as const;\n`;

writeFileSync(`${ROOT}/frontend/lib/abi.ts`, out);
console.log(`wrote frontend/lib/abi.ts (${clearbook.length} + ${vault.length} entries)`);
