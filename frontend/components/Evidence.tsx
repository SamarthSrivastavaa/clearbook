'use client';

import type { Hex } from 'viem';

import { SOURCE_CHAIN, explorer } from '@/lib/config';
import type { FactWithLinks } from '@/lib/data';
import { formatBlock, formatTokenAmount, shortAddress } from '@/lib/format';
import { Eyebrow, Ident } from './ui';

/**
 * The evidence presentation.
 *
 * Three registers, visually distinct, in the order the trust actually flows:
 *
 *   SOURCE-CHAIN FACT      what happened on Ethereum
 *   CREDITCOIN VERIFICATION what the precompile established about it
 *   CLEARBOOK INTERPRETATION what this application decided it means
 *
 * The separation is the product. A reader must never be able to mistake the
 * third register for the first.
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
  /** What Clearbook takes this to mean, and under which rule. */
  interpretation: string;
  /** Set when this leg is what makes a flow circular. */
  emphasis?: boolean;
  tokenDecimals: number | null;
  tokenSymbol: string | null;
}

/** One evidence record, in the three registers. */
export function EvidenceRecord({ item }: { item: EvidenceItem }) {
  const { fact } = item;

  return (
    <article
      className={`record ${item.emphasis ? 'border-l-breach' : ''}`}
      aria-label={`${ROLE_LABEL[item.role]} evidence`}
    >
      {/* --- Register 1: the source-chain fact --- */}
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Eyebrow>Source-chain fact · {SOURCE_CHAIN.name}</Eyebrow>
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">
            {ROLE_LABEL[item.role]}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px]">
          <a
            href={explorer.sourceAddress(fact.from)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[13px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
            title={fact.from}
          >
            {shortAddress(fact.from)}
          </a>
          <span className="text-ink-faint" aria-hidden>
            →
          </span>
          <a
            href={explorer.sourceAddress(fact.to)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[13px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
            title={fact.to}
          >
            {shortAddress(fact.to)}
          </a>
          <span className="tnum ml-2 font-medium">
            {formatTokenAmount(fact.amount, item.tokenDecimals)}
          </span>
          <a
            href={explorer.sourceToken(fact.token)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] text-ink-muted underline decoration-rule-strong underline-offset-4 hover:text-ink"
            title={fact.token}
          >
            {item.tokenSymbol ?? shortAddress(fact.token)}
          </a>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Cell label="Block">
            <a
              href={explorer.sourceBlock(fact.blockHeight)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
            >
              {formatBlock(fact.blockHeight)}
            </a>
          </Cell>
          <Cell label="Tx index">
            <span className="ident">{fact.txIndex.toString()}</span>
          </Cell>
          <Cell label="Log index">
            <span className="ident" title="Index within the receipt's own log array">
              {fact.logIndex}
            </span>
          </Cell>
          <Cell label="Receipt">
            <span className="text-[12px] font-medium text-verified">Status 1 · success</span>
          </Cell>
        </dl>

        {fact.txHash ? (
          <div className="mt-3">
            <Cell label="Transaction">
              <Ident value={fact.txHash} href={explorer.sourceTx(fact.txHash)} label="Source transaction" />
            </Cell>
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            The vault stores the transaction&rsquo;s coordinates, not its hash. The hash is recovered
            from the <code className="font-mono">TransferFactStored</code> event.
          </p>
        )}
      </div>

      {/* --- Register 2: what Creditcoin established --- */}
      <div className="rule-t bg-surface-sunken px-5 py-3.5">
        <Eyebrow>Creditcoin verification</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-ink">
          Inclusion in an attested source-chain block was verified by the Block Prover precompile.
          The receipt was decoded on-chain and its status asserted to be success.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Cell label="Chain key">
            <span className="ident">{fact.chainKey.toString()}</span>
          </Cell>
          <Cell label="Ingested at CC block">
            <a
              href={explorer.ccBlock(fact.ccBlock)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
            >
              {formatBlock(fact.ccBlock)}
            </a>
          </Cell>
          <Cell label="Submitted by">
            <a
              href={explorer.ccAddress(fact.submitter)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
              title={fact.submitter}
            >
              {shortAddress(fact.submitter)}
            </a>
          </Cell>
        </dl>
        {fact.ccTxHash ? (
          <div className="mt-3">
            <Cell label="Verification transaction">
              <Ident
                value={fact.ccTxHash}
                href={explorer.ccTx(fact.ccTxHash)}
                label="Creditcoin verification transaction"
              />
            </Cell>
          </div>
        ) : null}
        <div className="mt-3">
          <Cell label="Fact identifier">
            <Ident value={item.factId} label="factId" lead={12} tail={8} />
          </Cell>
        </div>
      </div>

      {/* --- Register 3: what Clearbook decided --- */}
      <div className="rule-t px-5 py-3.5">
        <Eyebrow>Clearbook interpretation</Eyebrow>
        <div className="interpretation mt-2">
          <p className="text-[13px] leading-relaxed text-ink">{item.interpretation}</p>
        </div>
      </div>
    </article>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="tnum mt-1">{children}</dd>
    </div>
  );
}

/**
 * The evidence sequence. A rail connects records in source-chain block order,
 * with the relationship between consecutive legs named on the connector.
 */
export function EvidenceFlow({ items }: { items: EvidenceItem[] }) {
  return (
    <ol className="space-y-0">
      {items.map((item, i) => (
        <li key={item.factId}>
          <EvidenceRecord item={item} />
          {i < items.length - 1 ? <Connector from={item} to={items[i + 1]} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Connector({ from, to }: { from: EvidenceItem; to: EvidenceItem }) {
  const gap = to.fact.blockHeight - from.fact.blockHeight;
  const sameAddress = from.fact.to.toLowerCase() === to.fact.from.toLowerCase();

  return (
    <div className="flex items-stretch gap-4 pl-5" aria-hidden={false}>
      <div className="connector my-1 ml-[9px]" />
      <div className="py-3 text-[11px] leading-relaxed text-ink-muted">
        {sameAddress ? (
          <>
            <span className="text-ink">Same address</span> — {shortAddress(from.fact.to)} received,
            then sent.
          </>
        ) : (
          <>Different counterparties.</>
        )}
        <span className="text-ink-faint">
          {' '}
          · {gap >= 0n ? gap.toString() : `−${(-gap).toString()}`} source blocks apart
        </span>
      </div>
    </div>
  );
}

/**
 * The explicit negative space. BUILD.md §0.4 requires that what the evidence
 * does NOT establish is stated as plainly as what it does.
 */
export function NotClaimed({ items }: { items: string[] }) {
  return (
    <div className="not-claimed">
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t} className="flex gap-3 text-[13px] leading-relaxed">
            <span aria-hidden className="select-none text-ink-faint">
              ✕
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
