'use client';

import type { Hex } from 'viem';

import { SOURCE_CHAIN, explorer } from '@/lib/config';
import type { FactWithLinks } from '@/lib/data';
import { formatBlock, formatTokenAmount, shortAddress } from '@/lib/format';
import { Disclosure, Eyebrow, Ident } from './ui';

/**
 * The evidence experience — Clearbook's signature screen.
 *
 * Structure follows the provenance rail: each verified transfer is a node, in
 * source-chain block order, because that ordering is what the covenant reasons
 * over. Between nodes the rail states the relationship that makes the sequence
 * meaningful — usually "the address that received is the address that sent".
 *
 * Three registers, never blurred:
 *   the transfer itself      — what happened on the source chain
 *   the verification         — what Creditcoin established about it
 *   the interpretation       — what this application decided it means
 *
 * Cryptographic internals sit behind progressive disclosure. They are available
 * on every node and in the way on none of them.
 */

export type Role = 'disbursement' | 'repayment' | 'funding' | 'unbound-funding';

const ROLE_LABEL: Record<Role, string> = {
  disbursement: 'Disbursement',
  repayment: 'Repayment',
  funding: 'Funding leg',
  'unbound-funding': 'Funding from an unbound address',
};

export interface EvidenceItem {
  factId: Hex;
  fact: FactWithLinks;
  role: Role;
  interpretation: string;
  /** Set when this leg is what makes a flow circular. */
  emphasis?: boolean;
  tokenDecimals: number | null;
  tokenSymbol: string | null;
}

/** An address as it should always appear: monospace, linked, never bare text. */
function Party({ address, label }: { address: string; label: string }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-faint">{label}</span>
      <a
        href={explorer.sourceAddress(address)}
        target="_blank"
        rel="noreferrer noopener"
        className="ident ident-link text-[13px]"
        title={address}
      >
        {shortAddress(address)}
      </a>
    </span>
  );
}

export function EvidenceRecord({ item }: { item: EvidenceItem }) {
  const { fact } = item;
  const amount = formatTokenAmount(fact.amount, item.tokenDecimals);

  return (
    <article aria-label={`${ROLE_LABEL[item.role]} evidence`}>
      {/* --- heading: what this leg is --- */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-medium">{ROLE_LABEL[item.role]}</h3>
        <span className="eyebrow">
          {SOURCE_CHAIN.name} · block {formatBlock(fact.blockHeight)}
        </span>
      </div>

      {/* --- the transfer itself: value moving between two parties --- */}
      <div
        className={`record mt-3 px-5 py-4 ${item.emphasis ? 'border-l-2 border-l-breach' : ''}`}
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Party address={fact.from} label="From" />

          <span className="flex flex-1 items-center gap-3 pb-1" aria-hidden>
            <span className="h-px flex-1 bg-rule-strong" />
            <span className="tnum whitespace-nowrap font-mono text-[14px] font-medium">
              {amount} {item.tokenSymbol ?? ''}
            </span>
            <span className="h-px flex-1 bg-rule-strong" />
            <span className="text-faint">→</span>
          </span>

          <Party address={fact.to} label="To" />
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-rule pt-3">
          <Meta k="Token">
            <a
              href={explorer.sourceToken(fact.token)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
              title={fact.token}
            >
              {item.tokenSymbol ?? shortAddress(fact.token)}
            </a>
          </Meta>
          <Meta k="Receipt">
            <span className="text-[12px] font-medium text-verified">status 1 · success</span>
          </Meta>
          <Meta k="Tx index">
            <span className="ident">{fact.txIndex.toString()}</span>
          </Meta>
          <Meta k="Log index">
            <span className="ident" title="Index within the receipt's own log array">
              {fact.logIndex}
            </span>
          </Meta>
          {fact.txHash ? (
            <Meta k="Transaction">
              <Ident value={fact.txHash} href={explorer.sourceTx(fact.txHash)} label="Source transaction" />
            </Meta>
          ) : null}
        </div>
      </div>

      {/* --- what Creditcoin established, and what we decided --- */}
      <div className="mt-3 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        <div>
          <Eyebrow>Verified by Creditcoin</Eyebrow>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            The Block Prover precompile proved this transaction&rsquo;s inclusion in an attested
            block. The receipt was decoded on-chain and its status asserted to be success.
          </p>
        </div>
        <div>
          <Eyebrow>Clearbook interpretation</Eyebrow>
          <div className="interpretation mt-2">
            <p className="text-[13px] leading-relaxed">{item.interpretation}</p>
          </div>
        </div>
      </div>

      {/* --- internals, available but never in the way --- */}
      <div className="mt-3">
        <Disclosure summary="Cryptographic detail" count={`chainKey ${fact.chainKey}`}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Meta k="Fact identifier" block>
              <Ident value={item.factId} label="factId" lead={14} tail={10} />
            </Meta>
            <Meta k="Ingested at Creditcoin block" block>
              <a
                href={explorer.ccBlock(fact.ccBlock)}
                target="_blank"
                rel="noreferrer noopener"
                className="ident ident-link"
              >
                {formatBlock(fact.ccBlock)}
              </a>
            </Meta>
            <Meta k="Submitted by" block>
              <a
                href={explorer.ccAddress(fact.submitter)}
                target="_blank"
                rel="noreferrer noopener"
                className="ident ident-link"
                title={fact.submitter}
              >
                {shortAddress(fact.submitter)}
              </a>
            </Meta>
            {fact.ccTxHash ? (
              <Meta k="Verification transaction" block>
                <Ident value={fact.ccTxHash} href={explorer.ccTx(fact.ccTxHash)} label="Creditcoin transaction" />
              </Meta>
            ) : null}
          </dl>
          <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-faint">
            Identity is <code className="font-mono">keccak256(chainKey, blockHeight, txIndex, logIndex)</code>.
            The log index is transaction-local — an index into this receipt&rsquo;s own log array, not
            the block-global index <code className="font-mono">eth_getLogs</code> returns.
          </p>
        </Disclosure>
      </div>
    </article>
  );
}

function Meta({ k, children, block = false }: { k: string; children: React.ReactNode; block?: boolean }) {
  return (
    <div className={block ? 'min-w-0' : 'min-w-0'}>
      <dt className="eyebrow">{k}</dt>
      <dd className="tnum mt-1">{children}</dd>
    </div>
  );
}

/**
 * The evidence sequence, on the rail. Ordered by source-chain block, because
 * that ordering is what the covenant reasons over.
 */
export function EvidenceFlow({ items }: { items: EvidenceItem[] }) {
  const ordered = [...items].sort((a, b) => Number(a.fact.blockHeight - b.fact.blockHeight));

  return (
    <ol className="rail">
      {ordered.map((item, i) => {
        const next = ordered[i + 1];
        return (
          <li
            key={item.factId}
            className="rail-node pb-10 last:pb-0"
            data-state={item.emphasis ? 'breach' : 'done'}
          >
            <EvidenceRecord item={item} />
            {next ? <Relationship from={item} to={next} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The link between two consecutive legs. This is the sentence the covenant
 * actually turns on, so it is stated rather than left to be inferred.
 */
function Relationship({ from, to }: { from: EvidenceItem; to: EvidenceItem }) {
  const gap = to.fact.blockHeight - from.fact.blockHeight;
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  // The relationships are checked in order of how much they matter to the
  // covenant. A shared sender is the circular pattern itself, so it must never
  // fall through to "not linked" — that would describe the breach as a
  // coincidence.
  let relation: React.ReactNode;
  if (eq(from.fact.to, to.fact.from)) {
    relation = (
      <>
        <span className="font-medium text-ink">{shortAddress(from.fact.to)}</span> received, then
        sent.
      </>
    );
  } else if (eq(from.fact.from, to.fact.from)) {
    relation = (
      <>
        <span className="font-medium text-ink">{shortAddress(to.fact.from)}</span> sent both legs
        {eq(from.fact.to, to.fact.to) ? (
          <> to the same address.</>
        ) : (
          <>.</>
        )}
      </>
    );
  } else if (eq(from.fact.to, to.fact.to)) {
    relation = (
      <>
        <span className="font-medium text-ink">{shortAddress(to.fact.to)}</span> received both legs.
      </>
    );
  } else {
    relation = <>Different counterparties — these legs are adjacent, not linked.</>;
  }

  return (
    <p className="mt-6 text-[12px] leading-relaxed text-muted">
      {relation}
      <span className="text-faint">
        {' '}
        · {gap >= 0n ? gap.toString() : `−${(-gap).toString()}`} source{' '}
        {gap === 1n || gap === -1n ? 'block' : 'blocks'} apart
      </span>
    </p>
  );
}

/**
 * The explicit negative space. What the evidence does NOT establish, stated as
 * plainly as what it does.
 */
export function NotClaimed({ items }: { items: string[] }) {
  return (
    <ul className="not-claimed grid gap-2.5 sm:grid-cols-2">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-[13px] leading-relaxed">
          <span aria-hidden className="select-none pt-0.5 text-faint">
            —
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
