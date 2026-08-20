/**
 * Structured JSON logging (BUILD.md §8.3): one line per state transition.
 *
 * NEVER log private keys, seed phrases or .env contents. `redact()` below is a
 * backstop, not a licence to pass secrets in — the rule is that they never enter
 * a log call in the first place.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? 'info'] ?? LEVELS.info;

/** Keys whose values are never printed, whatever they contain. */
const SECRET_KEYS = /(private|secret|mnemonic|seed|passphrase|password|key)$/i;

/** A 32-byte hex value in a field that is not an allowlisted public identifier. */
const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const PUBLIC_HEX64_KEYS = new Set([
  'txHash',
  'ccTxHash',
  'factId',
  'merkleRoot',
  'lowerEndpointDigest',
  'blockHash',
  'hash',
  'topic',
  'digest',
]);

export function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    // A bare 32-byte hex in an unrecognised field could be a private key.
    if (HEX64.test(value) && !PUBLIC_HEX64_KEYS.has(key)) return '[REDACTED:32-byte-hex]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

export interface LogFields {
  correlationId?: string;
  proofRequestId?: string;
  txHash?: string;
  ccTxHash?: string;
  state?: string;
  attempt?: number;
  latencyMs?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(redact(fields) as LogFields) };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};

/**
 * Counters and histograms (BUILD.md §8.3). Deliberately in-process: the worker is
 * a single process and adding a metrics backend would be scope BUILD.md forbids.
 * Exposed through GET /health.
 */
class Metrics {
  private counters = new Map<string, number>();
  private samples = new Map<string, number[]>();

  increment(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, value: number): void {
    const arr = this.samples.get(name) ?? [];
    arr.push(value);
    this.samples.set(name, arr);
  }

  private key(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return name;
    return `${name}{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
  }

  snapshot(): Record<string, unknown> {
    const histograms: Record<string, unknown> = {};
    for (const [name, values] of this.samples) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      histograms[name] = {
        count: sorted.length,
        min: sorted[0],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p90: sorted[Math.floor(sorted.length * 0.9)],
        max: sorted[sorted.length - 1],
      };
    }
    return { counters: Object.fromEntries(this.counters), histograms };
  }
}

export const metrics = new Metrics();
