import { NextResponse } from 'next/server';

/**
 * Server-side proxy to the Attestcoin proof builder.
 *
 * A browser cannot call the prover directly — it is a different origin and does
 * not send CORS headers. This route forwards two read-only endpoints and nothing
 * else. It holds no secrets, signs nothing, and adds no trust: the proof it
 * returns is meaningless until the precompile verifies it on-chain.
 *
 * Paths mirror the SDK's ApiClient exactly:
 *   /api/v1/attested-height/{chainKey}
 *   /api/v1/proof-by-tx/{chainKey}/{txHash}
 */

const PROVER_FALLBACK = 'https://prover.cc3-testnet.creditcoin.network';

/**
 * The proof builder's origin.
 *
 * `??` was wrong here and broke the deployed site: it falls back only on null or
 * undefined, so a platform environment variable that exists but is empty left
 * this as the empty string. Every forward then became a relative URL, `fetch`
 * refused to parse it, and the proxy reported the prover unreachable while the
 * prover was in fact healthy. An env var that is present but blank must be
 * treated as absent, so this normalises and falls back on any empty value.
 */
const PROVER_URL = (process.env.PROOF_BUILDER_URL ?? '').trim().replace(/\/$/, '') || PROVER_FALLBACK;

const TIMEOUT_MS = 30_000;

async function forward(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PROVER_URL}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: 'prover_error', status: res.status, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json(
      {
        error: aborted ? 'prover_timeout' : 'prover_unreachable',
        detail: aborted
          ? `The proof builder did not respond within ${TIMEOUT_MS / 1000}s.`
          : (e as Error).message,
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const chainKey = url.searchParams.get('chainKey');
  const txHash = url.searchParams.get('txHash');

  if (!chainKey || !/^\d+$/.test(chainKey)) {
    return NextResponse.json({ error: 'bad_request', detail: 'chainKey required' }, { status: 400 });
  }

  if (kind === 'attested-height') {
    return forward(`/api/v1/attested-height/${chainKey}`);
  }

  if (kind === 'proof') {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: 'bad_request', detail: 'txHash must be 32 bytes of hex' },
        { status: 400 },
      );
    }
    return forward(`/api/v1/proof-by-tx/${chainKey}/${txHash}`);
  }

  return NextResponse.json({ error: 'bad_request', detail: 'unknown kind' }, { status: 400 });
}
