'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Hex } from 'viem';

import { CommitGuard } from '@/components/CommitGuard';
import { NotDeployed, RpcError } from '@/components/States';
import { Disclosure, Empty, Eyebrow, Ident, Status } from '@/components/ui';
import { DEMO_ARTIFACTS, PRECOMPILES, explorer, sourceChain } from '@/lib/config';
import { formatBlock, formatTokenAmount, shortAddress } from '@/lib/format';
import { tokenMeta } from '@/lib/token';
import { dataSource, useBookLoans, useBookOriginators, useFactConsumers, useVaultFacts } from '@/lib/data';
import { useCoverage } from '@/lib/hooks';
import { CoveragePanel } from '@/components/Coverage';
import { VAULT_LOOKBACK_BLOCKS, type VaultFact } from '@/lib/hooks';

/**
 * The evidence registry.
 *
 * This is the state the whole system rests on: which verified facts exist, and
 * which claim — if any — has consumed each one. It is deliberately not an
 * explorer. An explorer answers "what happened on a chain"; this answers "what
 * can still be committed to a credit claim, and what cannot".
 *
 * The distinction the page exists to make visible:
 *
 *   VERIFICATION requires no permission — anyone may prove a transfer occurred,
 *   including transfers on Ethereum mainnet between parties who have never
 *   heard of Clearbook.
 *
 *   COMMITMENT does — binding a fact to a claim requires a treasury the
 *   originator proved control of by signature.
 *
 * Consumption state is read from `Clearbook.factConsumedBy`, never inferred.
 */
export default function RegistryPage() {
  const { facts, isLoading } = useVaultFacts();
  const { loans } = useBookLoans();
  const { originators } = useBookOriginators();
  const originatorIds = useMemo(() => originators.map((o) => o.id), [originators]);
  const { coverage, isLoading: coverageLoading } = useCoverage(originatorIds);
  const [open, setOpen] = useState<Hex | null>(null);

  const factIds = useMemo(() => facts.map((f) => f.factId), [facts]);
  const { consumers, isLoading: consumersLoading } = useFactConsumers(factIds);

  const loanById = useMemo(() => new Map(loans.map((l) => [l.id.toString(), l])), [loans]);
  const originatorById = useMemo(
    () => new Map(originators.map((o) => [o.id.toString(), o])),
    [originators],
  );

  const ordered = useMemo(
    () =>
      [...facts].sort((a, b) => a.chainKey - b.chainKey || Number(a.blockHeight - b.blockHeight)),
    [facts],
  );

  if (dataSource === 'none') return <NotDeployed />;

  const consumedCount = ordered.filter((f) => (consumers.get(f.factId.toLowerCase()) ?? 0n) > 0n).length;
  const liveChainCount = ordered.filter((f) => sourceChain(f.chainKey).live).length;
  const selected = ordered.find((f) => f.factId === open) ?? null;

  return (
    <div className="space-y-10">
      <header>
        <Eyebrow>Evidence registry</Eyebrow>
        <h1 className="display-lg mt-2">The evidence this book runs on.</h1>
        <p className="prose-lead mt-4 max-w-2xl">
          Verification needs no permission — anyone can prove a transfer happened, including
          transfers between parties who have never heard of Clearbook.{' '}
          <span className="text-ink">Commitment does.</span> Binding a fact to a claim requires a
          treasury the originator proved control of by signature, and no fact may be committed twice.
        </p>

        {!isLoading && ordered.length > 0 ? (
          <p className="mt-5 text-[13px] leading-relaxed text-muted">
            <Figure>{ordered.length}</Figure> verified facts ·{' '}
            <Figure>{consumersLoading ? '—' : consumedCount}</Figure> committed to a claim ·{' '}
            <Figure>{liveChainCount}</Figure> from a chain carrying real value
          </p>
        ) : null}

        {/* The listing is a bounded scan of the vault's own logs, not the whole
            history. Saying so matters more here than anywhere else in the
            product: a page that implied completeness it does not have would
            undercut the one claim everything else rests on. */}
        {!isLoading && ordered.length > 0 ? (
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            Listed from the last {Number(VAULT_LOOKBACK_BLOCKS).toLocaleString('en-US')} Creditcoin
            blocks. There is no indexer on this chain and the vault keeps no enumerable list, so
            discovery is a bounded log scan — an older fact is still fully citable by identifier, and{' '}
            <span className="text-muted">the contract accepts it regardless</span>. The bound limits
            this listing, never what the protocol will take.
          </p>
        ) : null}
      </header>

      {/*
        Coverage answers the objection every reader of an evidence-bound book
        arrives with: that the originator simply does not register what it would
        rather nobody saw. Clearbook cannot stop that. It can measure it, and
        measuring it is worth more than pretending the book is complete.
      */}
      {originators.length > 0 ? (
        <section className="space-y-4">
          <div>
            <Eyebrow>Declared activity</Eyebrow>
            <h2 className="mt-2 text-[19px] font-semibold tracking-tight">
              How much of each book is actually on the book.
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
              Nothing forces an originator to register a loan. So rather than assume the book is
              complete, Clearbook measures the share of declared-treasury activity that reached a
              claim. This is a ratio, not a rating.
            </p>
          </div>

          {coverageLoading ? (
            <p className="text-[13px] text-faint">
              Measuring declared activity against the source chain…
            </p>
          ) : coverage === null ? null : (
            <div className="grid gap-4 lg:grid-cols-2">
              {coverage.map((c) => (
                <CoveragePanel
                  key={c.originatorId.toString()}
                  coverage={c}
                  name={originators.find((o) => o.id === c.originatorId)?.name ?? `Originator ${c.originatorId}`}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isLoading ? (
        <p className="text-[13px] text-faint">Reading the vault from Creditcoin…</p>
      ) : ordered.length === 0 ? (
        <Empty title="No evidence yet">
          The vault is deployed but holds no facts. Anyone may submit one — ingestion is
          permissionless and requires no relationship with any originator.
        </Empty>
      ) : (
        <FactTable
          facts={ordered}
          consumers={consumers}
          consumersLoading={consumersLoading}
          loanById={loanById}
          originatorById={originatorById}
          onOpen={setOpen}
          openId={open}
        />
      )}

      {selected ? (
        <FactDetail
          fact={selected}
          consumedBy={consumers.get(selected.factId.toLowerCase()) ?? null}
          loanById={loanById}
          originatorById={originatorById}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function Figure({ children }: { children: React.ReactNode }) {
  return <span className="tnum font-mono text-[13px] font-medium text-ink">{children}</span>;
}

function FactTable({
  facts,
  consumers,
  consumersLoading,
  loanById,
  originatorById,
  onOpen,
  openId,
}: {
  facts: VaultFact[];
  consumers: Map<string, bigint>;
  consumersLoading: boolean;
  loanById: Map<string, { id: bigint; originatorId: bigint }>;
  originatorById: Map<string, { name: string }>;
  onOpen: (id: Hex) => void;
  openId: Hex | null;
}) {
  return (
    <section>
      <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
        <Eyebrow>Verified facts</Eyebrow>
        <span className="text-[11px] text-faint">Consumption read from Clearbook, not inferred</span>
      </div>

      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="rule-b">
              {['Source', 'Transfer', 'Amount', 'Block', 'Verification', 'Committed to'].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint ${
                    i >= 2 ? 'text-right' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {facts.map((f) => {
              const chain = sourceChain(f.chainKey);
              const consumed = consumers.get(f.factId.toLowerCase());
              const isConsumed = consumed !== undefined && consumed > 0n;
              const loan = isConsumed ? loanById.get(consumed.toString()) : undefined;
              const originator = loan ? originatorById.get(loan.originatorId.toString()) : undefined;
              const { decimals, symbol } = tokenMeta(f.token);

              return (
                <tr
                  key={f.factId}
                  onClick={() => onOpen(f.factId)}
                  aria-selected={openId === f.factId}
                  className={`rule-b group cursor-pointer transition-colors hover:bg-sunken ${
                    openId === f.factId ? 'bg-sunken' : ''
                  }`}
                >
                  <td className={`py-3.5 ${chain.live ? 'border-l-2 border-l-accent pl-3' : 'pl-3'}`}>
                    <div className="text-[13px] font-medium">{chain.short}</div>
                    <div className="text-[11px] text-faint">
                      {chain.live ? 'real value' : 'testnet'}
                    </div>
                  </td>

                  <td className="py-3.5">
                    <span className="flex items-center gap-2 text-[12px]">
                      <span className="ident">{shortAddress(f.from)}</span>
                      <span className="text-faint" aria-hidden>
                        →
                      </span>
                      <span className="ident">{shortAddress(f.to)}</span>
                    </span>
                  </td>

                  <td className="tnum py-3.5 text-right font-mono text-[13px]">
                    {formatTokenAmount(f.amount, decimals)}{' '}
                    <span className="text-muted">{symbol ?? ''}</span>
                  </td>

                  <td className="tnum py-3.5 text-right font-mono text-[12px] text-muted">
                    {formatBlock(f.blockHeight)}
                  </td>

                  <td className="py-3.5 text-right">
                    <div className="flex justify-end">
                      <Status tone="verified">Verified</Status>
                    </div>
                  </td>

                  <td className="py-3.5 pr-3 text-right">
                    {consumersLoading && consumed === undefined ? (
                      <span className="text-[12px] text-faint">reading…</span>
                    ) : consumed === undefined ? (
                      <span className="text-[12px] text-pending" title="Could not read consumption state">
                        unknown
                      </span>
                    ) : isConsumed ? (
                      <span className="text-[12px]">
                        <Link
                          href={`/loan/${consumed}`}
                          onClick={(e) => e.stopPropagation()}
                          className="link font-mono"
                        >
                          L-{consumed.toString().padStart(3, '0')}
                        </Link>
                        {originator ? (
                          <span className="block text-[11px] text-faint">{originator.name}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted">
                        Unconsumed
                        <span className="block text-[11px] text-faint">available to commit</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One fact, in full — and the provenance that produced it.
 *
 * The rail separates what Ethereum did from what Creditcoin proved from what
 * Clearbook decided. Those are three different kinds of statement and the
 * interface never merges them.
 */
function FactDetail({
  fact,
  consumedBy,
  loanById,
  originatorById,
  onClose,
}: {
  fact: VaultFact;
  consumedBy: bigint | null;
  loanById: Map<string, { id: bigint; originatorId: bigint }>;
  originatorById: Map<string, { name: string }>;
  onClose: () => void;
}) {
  const chain = sourceChain(fact.chainKey);
  const { decimals, symbol } = tokenMeta(fact.token);
  const isConsumed = consumedBy !== null && consumedBy > 0n;
  const loan = isConsumed ? loanById.get(consumedBy.toString()) : undefined;
  const originator = loan ? originatorById.get(loan.originatorId.toString()) : undefined;

  const steps: Array<{ chain: string; title: string; body: React.ReactNode; state?: string }> = [
    {
      chain: chain.name,
      title: 'A transfer happened',
      state: 'done',
      body: (
        <>
          <span className="ident">{shortAddress(fact.from)}</span> sent{' '}
          <span className="tnum font-mono font-medium">
            {formatTokenAmount(fact.amount, decimals)} {symbol ?? ''}
          </span>{' '}
          to <span className="ident">{shortAddress(fact.to)}</span> in block{' '}
          <span className="tnum font-mono">{formatBlock(fact.blockHeight)}</span>.
          {chain.live ? ' This is real value on a public chain we do not control.' : ''}
        </>
      ),
    },
    {
      chain: 'Attestcoin',
      title: 'The block was attested',
      state: 'done',
      body: 'Attestors reached quorum on the finalized source block, making a proof of inclusion available.',
    },
    {
      chain: `Creditcoin · ${shortAddress(PRECOMPILES.blockProver)}`,
      title: 'The precompile verified inclusion',
      state: 'done',
      body: 'Inclusion proven on-chain and the receipt decoded by the official decoder. Its status was asserted to be success — the precompile proves inclusion, not success, so Clearbook checks that itself.',
    },
    {
      chain: 'Clearbook',
      title: isConsumed ? 'Committed to a claim' : 'Recorded, not committed',
      state: isConsumed ? 'done' : 'active',
      body: isConsumed ? (
        <>
          Committed to{' '}
          <Link href={`/loan/${consumedBy}`} className="link font-mono">
            L-{consumedBy!.toString().padStart(3, '0')}
          </Link>
          {originator ? <> by {originator.name}</> : null}. No other claim can commit it.
        </>
      ) : (
        <>
          This fact is verified and available. Committing it requires a treasury bound by signature
          to the committing originator — which is why a mainnet transfer between strangers can be
          proven here but never claimed here.
        </>
      ),
    },
  ];

  return (
    <section className="rule-t pt-8" aria-label="Fact detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Fact detail</Eyebrow>
          <div className="mt-2">
            <Ident value={fact.factId} label="factId" lead={16} tail={12} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-muted underline-offset-4 hover:underline"
        >
          Close
        </button>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <ol className="rail">
          {steps.map((s) => (
            <li key={s.title} className="rail-node pb-8 last:pb-0" data-state={s.state}>
              <div className="eyebrow">{s.chain}</div>
              <div className="mt-1.5 text-[15px] font-medium">{s.title}</div>
              <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>

        <div>
          <Eyebrow>Coordinates</Eyebrow>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-4">
            <Meta k="Source chain">{chain.name}</Meta>
            <Meta k="Chain key">
              <span className="ident">{fact.chainKey}</span>
            </Meta>
            <Meta k="Block">
              <span className="tnum font-mono text-[12px]">{formatBlock(fact.blockHeight)}</span>
            </Meta>
            <Meta k="Log index">
              <span className="ident" title="Index within this receipt's own log array">
                {fact.logIndex}
              </span>
            </Meta>
            <Meta k="Token">
              {chain.explorer ? (
                <a
                  href={explorer.sourceToken(fact.token, fact.chainKey)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ident ident-link"
                >
                  {symbol ?? shortAddress(fact.token)}
                </a>
              ) : (
                <span className="ident">{symbol ?? shortAddress(fact.token)}</span>
              )}
            </Meta>
            <Meta k="Receipt">
              <span className="text-[12px] font-medium text-verified">status 1 · success</span>
            </Meta>
          </dl>

          {isConsumed && loan && loan.originatorId !== DEMO_ARTIFACTS.secondOriginatorId ? (
            <CommitGuard
              factId={fact.factId}
              token={fact.token}
              borrower={fact.to}
              amount={fact.amount}
              otherOriginatorId={DEMO_ARTIFACTS.secondOriginatorId}
              otherOriginatorName={DEMO_ARTIFACTS.secondOriginatorName}
              otherOriginatorOwner={DEMO_ARTIFACTS.secondOriginatorOwner}
              incumbentLoanId={consumedBy!}
              recordedTxHash={DEMO_ARTIFACTS.duplicateCommitmentTx}
            />
          ) : null}

          <div className="mt-6">
            <Disclosure
              summary="What this does and does not establish"
              count={isConsumed ? 'committed' : 'uncommitted'}
            >
              <p className="max-w-lg text-[12px] leading-relaxed text-muted">
                Establishes that this transaction was included in an attested block, that its
                receipt succeeded, and that one of its logs was an ERC-20 transfer of this amount
                between these two addresses.
              </p>
              <p className="mt-3 max-w-lg text-[12px] leading-relaxed text-faint">
                Does not establish that either address belongs to any person or company, that an
                off-chain agreement exists, what the payment was for, or that the same underlying
                obligation is not represented by some other transaction elsewhere.
              </p>
            </Disclosure>
          </div>
        </div>
      </div>
    </section>
  );
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{k}</dt>
      <dd className="tnum mt-1 text-[13px]">{children}</dd>
    </div>
  );
}
