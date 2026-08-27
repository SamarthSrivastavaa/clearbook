import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { clearbookAbi } from '@/lib/abi';
import { DEMO_ARTIFACTS, creditcoin } from '@/lib/config';
import { decodeRevert } from '@/lib/errors';

/**
 * The duplicate commitment, sent for real.
 *
 * The landing page already proves exclusivity with an `eth_call`. This route is
 * the escalation: it broadcasts the same attempt as an actual transaction, so
 * the refusal has a receipt a reader can open on the explorer rather than a
 * simulation they have to take our word for.
 *
 * This endpoint is deliberately not a signing service. It reads **no request
 * body at all**. Every parameter of the transaction is a constant in this file
 * or read from server environment, so no caller-supplied input can change the
 * destination, the calldata, the signer, or the value. The only thing a caller
 * controls is whether the attempt happens.
 *
 * Why the signer must be originator B's owner: `registerLoan` checks `NotOwner`
 * before anything else, so a transaction from any other account would be refused
 * for the wrong reason and would prove nothing about uniqueness.
 *
 * Blast radius, stated plainly. This key owns originator 2 and could withdraw
 * its bond or bind a treasury to it. It cannot reach the consumed fact, the
 * incumbent claim, the evidence vault, or the verdict the landing page renders:
 * `registerLoan` reaches `FactAlreadyUsed` before `InsufficientBond`, so even an
 * unbonded originator still produces that same refusal. It is a throwaway
 * testnet key holding testnet funds.
 */

export const dynamic = 'force-dynamic';

/** Bypasses gas estimation, which would otherwise refuse to build a reverting
 *  call and leave us with no transaction to show. Proven in demo/collision.ts. */
const GAS_LIMIT = 500_000n;

/** `BadWindow` requires maturity strictly beyond the current block, and it is
 *  checked BEFORE the uniqueness guard. Max int64 satisfies it permanently, so
 *  this constant cannot go stale and cause a refusal for the wrong reason. */
const MATURITY_BLOCK = 9223372036854775807n;

/** The refusal this route exists to demonstrate. Anything else is reported as
 *  itself, and never broadcast. */
const EXPECTED_ERROR = 'FactAlreadyUsed';

const RECEIPT_TIMEOUT_MS = 45_000;

/** One send per caller per minute, and a ceiling on total sends per hour. The
 *  transaction always reverts, so abuse costs gas and nothing else; these bounds
 *  exist to keep a throwaway wallet solvent through a judging window, not to
 *  defend state that this route cannot reach. In-memory, so on a platform that
 *  runs several instances these are per-instance and best-effort. */
const PER_IP_COOLDOWN_MS = 60_000;
const GLOBAL_HOURLY_CAP = 60;

const RPC_URL = (process.env.CREDITCOIN_RPC_URL ?? '').trim() || creditcoin.rpcUrls.default.http[0];
const RELAYER_KEY = (process.env.ORIGINATOR_B_PRIVATE_KEY ?? '').trim();
const CLEARBOOK = (process.env.NEXT_PUBLIC_CLEARBOOK_ADDRESS ?? '').trim();

type Outcome =
  | { state: 'disabled'; detail: string }
  | { state: 'rate_limited'; retryAfterMs: number }
  | { state: 'precondition_changed'; simulated: string | null; detail: string }
  | { state: 'relayer_error'; detail: string }
  | {
      state: 'reverted';
      error: string | null;
      hash: Hex;
      receiptStatus: 'reverted';
      blockNumber: string;
      ms: number;
    }
  | {
      state: 'mined_unexpectedly';
      hash: Hex;
      receiptStatus: 'success';
      detail: string;
    }
  | { state: 'pending'; hash: Hex; detail: string };

const lastSeen = new Map<string, number>();
let hourWindowStart = Date.now();
let hourCount = 0;

/** Requests arriving while a send is in flight join it rather than starting a
 *  second one. Without this, concurrent clicks race for the same nonce and
 *  multiply the gas spent to show one identical result. */
let inFlight: Promise<Outcome> | null = null;

function rateLimited(ip: string): number | null {
  const now = Date.now();
  if (now - hourWindowStart > 3_600_000) {
    hourWindowStart = now;
    hourCount = 0;
  }
  if (hourCount >= GLOBAL_HOURLY_CAP) return hourWindowStart + 3_600_000 - now;
  const prev = lastSeen.get(ip);
  if (prev && now - prev < PER_IP_COOLDOWN_MS) return PER_IP_COOLDOWN_MS - (now - prev);
  return null;
}

function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0]!.slice(0, 200);
}

async function collide(): Promise<Outcome> {
  const started = Date.now();
  const pinned = DEMO_ARTIFACTS.pinnedFact;

  const account = privateKeyToAccount(RELAYER_KEY as Hex);
  const transport = http(RPC_URL);
  const pub = createPublicClient({ chain: creditcoin, transport });
  const wallet = createWalletClient({ account, chain: creditcoin, transport });

  const args = [
    DEMO_ARTIFACTS.secondOriginatorId,
    pinned.token,
    pinned.borrower,
    pinned.amount,
    MATURITY_BLOCK,
    pinned.factId,
  ] as const;

  // 1 · Establish what the chain says before spending anything.
  //
  // This gate is what makes the route safe. If consumption state ever changed,
  // an unguarded broadcast would SUCCEED and permanently commit this fact under
  // originator B — the one action here capable of damaging the registry.
  // Refusing to send unless the call is already doomed makes that outcome
  // unreachable rather than merely unlikely.
  let simulated: string | null = null;
  try {
    await pub.simulateContract({
      address: CLEARBOOK as Hex,
      abi: clearbookAbi,
      functionName: 'registerLoan',
      account,
      args,
    });
    return {
      state: 'precondition_changed',
      simulated: null,
      detail:
        'The contract did not refuse this call. Nothing was sent: broadcasting now would commit the fact rather than demonstrate that it cannot be committed.',
    };
  } catch (e) {
    simulated = decodeRevert(e)?.name ?? null;
  }

  if (simulated !== EXPECTED_ERROR) {
    return {
      state: 'precondition_changed',
      simulated,
      detail: `The contract refused, but with ${simulated ?? 'an unnamed error'} rather than ${EXPECTED_ERROR}. Nothing was sent, because a transaction rejected for a different reason would not show what this demonstration claims to show.`,
    };
  }

  // 2 · Send it. Explicit gas, because estimation refuses a reverting call.
  let hash: Hex;
  try {
    hash = await wallet.writeContract({
      address: CLEARBOOK as Hex,
      abi: clearbookAbi,
      functionName: 'registerLoan',
      args,
      gas: GAS_LIMIT,
    });
  } catch (e) {
    return { state: 'relayer_error', detail: shortError(e) };
  }

  // 3 · Read the outcome from the chain. viem resolves a reverted receipt
  //     normally rather than throwing, so status is read here, never inferred.
  try {
    const receipt = await pub.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status === 'success') {
      return {
        state: 'mined_unexpectedly',
        hash,
        receiptStatus: 'success',
        detail:
          'The transaction succeeded. That contradicts the simulation taken moments earlier, and should be treated as a real finding rather than a display error.',
      };
    }
    return {
      state: 'reverted',
      error: simulated,
      hash,
      receiptStatus: 'reverted',
      blockNumber: receipt.blockNumber.toString(),
      ms: Date.now() - started,
    };
  } catch {
    return {
      state: 'pending',
      hash,
      detail:
        'Broadcast, but no receipt arrived within the wait. The transaction is real and can be opened on the explorer.',
    };
  }
}

export async function POST(request: Request) {
  // Nothing is read from the request except its origin address, and that is used
  // only for rate limiting. No field of the transaction can be influenced.
  if (!RELAYER_KEY || !CLEARBOOK) {
    return NextResponse.json(
      {
        state: 'disabled',
        detail: 'No relayer is configured for this deployment. The live check above is unaffected.',
      } satisfies Outcome,
      { status: 503 },
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const wait = rateLimited(ip);
  if (wait !== null) {
    return NextResponse.json({ state: 'rate_limited', retryAfterMs: wait } satisfies Outcome, {
      status: 429,
    });
  }

  if (!inFlight) {
    hourCount++;
    lastSeen.set(ip, Date.now());
    inFlight = collide().finally(() => {
      inFlight = null;
    });
  }

  const outcome = await inFlight;
  const status = outcome.state === 'reverted' || outcome.state === 'pending' ? 200 : 409;
  return NextResponse.json(outcome, { status });
}
