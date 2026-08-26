'use client';

import Link from 'next/link';
import type { Hex } from 'viem';

import { useFactById, useFactConsumer } from '@/lib/data';
import { explorer } from '@/lib/config';
import { formatTokenAmount, shortAddress, shortHash } from '@/lib/format';
import { tokenMeta } from '@/lib/token';

/**
 * The landing page's live result.
 *
 * This replaced a static diagram of the protocol, which explained the product
 * rather than demonstrating it. A judge arriving cold should see the system
 * having already decided something, on state read from the deployed contract,
 * before they have clicked anything or connected anything.
 *
 * WHY THIS AND NOT A FULL CLEARANCE RUN
 *
 * The complete check locates the transaction, resolves the chain key, fetches a
 * proof and has the Block Prover precompile rule on it. That is the honest path
 * and it takes ten to twenty seconds, which is a spinner in the most valuable
 * space on the site. The verdict itself, though, is one contract read:
 * `factConsumedBy[factId]` is what makes a fact encumbered, and it answers in
 * well under a second.
 *
 * So this card reads the book, and says plainly that it is reading the book. The
 * cryptographic half is one click away and is labelled as such. Nothing here is
 * staged, cached or replayed: if the mapping changed, this card would change.
 */

/**
 * Scenario A's disbursement, committed to loan 1.
 *
 * Derived from Sepolia transaction 0xd922115f… at block 11,538,664, transaction
 * index 87, transaction-local log 0, and pinned here rather than recomputed
 * because deriving it in the browser would mean a source-chain round trip for a
 * value that cannot change. `integration/gate11-clearance.ts` checks this
 * derivation against `EvidenceVault.computeFactId` on the deployed contract.
 *
 * Safe to pin: consumption is permanent. `factConsumedBy` is never cleared, so a
 * fact committed once stays committed for the life of the deployment. Re-seeding
 * the demo does not disturb it.
 */
const PINNED_FACT = '0x381fd23402601eecc14df7785f595488235490ef367e989bc3746f3c56171ac3' as Hex;

export function EvidenceStatus() {
  const { fact, exists, isLoading } = useFactById(PINNED_FACT);
  const consumer = useFactConsumer(PINNED_FACT);

  const loading = isLoading || consumer === null;
  const encumbered = consumer !== null && consumer !== 0n;
  const meta = fact ? tokenMeta(fact.token) : { symbol: null, decimals: null };

  return (
    <div className="border-2 border-onDeep bg-deep">
      <div className="flex items-baseline justify-between gap-4 border-b border-[#3a382f] px-6 py-3">
        <span className="eyebrow text-onDeepMuted">Evidence status</span>
        <span className="text-[11px] text-onDeepMuted">
          {loading ? 'reading…' : 'live read · deployed contract'}
        </span>
      </div>

      <div className="px-6 py-6">
        {loading ? (
          <div className="space-y-3" aria-busy>
            <div className="h-7 w-2/3 bg-[#2e2c25]" />
            <div className="h-4 w-1/2 bg-[#26241e]" />
          </div>
        ) : !exists ? (
          // Never silently blank. If the vault does not hold this fact, that is
          // itself information and the page says so rather than showing nothing.
          <p className="text-[14px] leading-relaxed text-onDeepMuted">
            This deployment does not hold the pinned fact.{' '}
            <Link href="/registry" className="text-onDeep underline underline-offset-4">
              Open the registry
            </Link>{' '}
            to see what it does hold.
          </p>
        ) : (
          <>
            {/*
              Two facts, in the order the protocol establishes them. Presence in
              the vault IS verification: nothing is stored there until the Block
              Prover precompile has ruled on it, so "verified" here is a
              statement about what the contract did, not a label we applied.
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-verified">
                Verified
              </span>
              <span className="text-[11px] text-onDeepMuted" aria-hidden>
                &rarr;
              </span>
              <span
                className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${
                  encumbered ? 'text-breach' : 'text-verified'
                }`}
              >
                {encumbered ? 'Encumbered' : 'Clear'}
              </span>
            </div>

            <p className="display-md mt-2 text-onDeep">
              {encumbered ? 'Encumbered in Clearbook' : 'Clear in Clearbook'}
            </p>

            <p className="mt-2 text-[13px] leading-relaxed text-onDeepMuted">
              {encumbered ? (
                <>
                  This verified transfer is already committed to a claim. The protocol refuses a
                  second claim citing it, from this originator or any other. It does not establish
                  anything about the underlying obligation.
                </>
              ) : (
                <>
                  This verified transfer is in the registry and no claim cites it. It is available
                  to commit, once.
                </>
              )}
            </p>

            {/* The evidence itself, so the verdict is attached to something real. */}
            {fact ? (
              <dl className="mt-5 space-y-2.5 border-t border-[#2e2c25] pt-4 text-[12px]">
                <Row k="Transfer">
                  <span className="tnum text-onDeep">
                    {formatTokenAmount(fact.amount, meta.decimals)}
                  </span>{' '}
                  <span className="text-onDeepMuted">{meta.symbol ?? shortAddress(fact.token)}</span>{' '}
                  <span className="text-onDeepMuted">
                    {shortAddress(fact.from)} &rarr; {shortAddress(fact.to)}
                  </span>
                </Row>
                <Row k="Fact identity">
                  <a
                    href={explorer.sourceBlock(fact.blockHeight, fact.chainKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ident text-onDeepMuted underline decoration-[#3a382f] underline-offset-4"
                  >
                    {shortHash(PINNED_FACT, 10, 6)}
                  </a>
                </Row>
                {encumbered ? (
                  <Row k="Committed to">
                    <Link
                      href={`/loan/${consumer}`}
                      className="text-onDeep underline underline-offset-4"
                    >
                      Loan #{String(consumer)}
                    </Link>
                  </Row>
                ) : null}
              </dl>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#2e2c25] pt-4">
              {encumbered ? (
                <Link
                  href={`/loan/${consumer}`}
                  className="text-[13px] font-semibold text-onDeep underline underline-offset-4"
                >
                  Inspect the claim &rarr;
                </Link>
              ) : null}
              <Link href="/clearance" className="text-[13px] text-onDeepMuted hover:text-onDeep">
                Run the full check &rarr;
              </Link>
            </div>

            {/* Says exactly which half of the pipeline produced this. */}
            <p className="mt-4 text-[11px] leading-relaxed text-onDeepMuted">
              Read from <span className="ident">factConsumedBy</span> on the deployed book. The
              cryptographic half, proving the transfer occurred on Ethereum, runs on{' '}
              <Link href="/clearance" className="underline underline-offset-2">
                clearance
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-[92px] shrink-0 text-onDeepMuted">{k}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
