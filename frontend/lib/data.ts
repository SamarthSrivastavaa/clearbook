'use client';

import { useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { useBlockNumber } from 'wagmi';

import { isDeployed } from './config';
import {
  FIXTURE_CURRENT_BLOCK,
  FIXTURE_FACT_CONSUMED_BY,
  FIXTURE_FACT_INDEX,
  FIXTURE_LOANS,
  FIXTURE_ORIGINATOR,
  FIXTURE_PARAMS,
  PREVIEW,
  fixtureTreasuryOwner,
  type FixtureFact,
} from './fixtures';
import {
  useFact as useChainFact,
  useLoan as useChainLoan,
  useLoans as useChainLoans,
  useOriginator as useChainOriginator,
  useOriginators as useChainOriginators,
  useProtocolParameters as useChainParams,
  useTreasuryOwner as useChainTreasuryOwner,
} from './hooks';
import type { Loan, Originator, TransferFact } from './protocol';

/**
 * The single place that decides whether the UI is reading the chain or a preview
 * fixture. Pages consume these hooks and never branch on preview themselves, so
 * there is exactly one seam between real state and illustrative state.
 *
 * `source` is returned alongside every result so a screen can always say which
 * it is showing. Nothing may render fixture data without disclosing it.
 */

export type DataSource = 'chain' | 'preview' | 'none';

export const dataSource: DataSource = isDeployed ? 'chain' : PREVIEW ? 'preview' : 'none';
export const isPreview = dataSource === 'preview';

export function useCurrentBlock(): bigint | undefined {
  const { data } = useBlockNumber({
    watch: !isPreview,
    query: { enabled: !isPreview, refetchInterval: 12_000 },
  });
  return isPreview ? FIXTURE_CURRENT_BLOCK : data;
}

export function useBookLoans(): { loans: Loan[]; isLoading: boolean; error: Error | null } {
  const chain = useChainLoans();
  if (isPreview) return { loans: FIXTURE_LOANS, isLoading: false, error: null };
  return { loans: chain.loans, isLoading: chain.isLoading, error: (chain.error as Error) ?? null };
}

export function useBookOriginators(): { originators: Originator[]; isLoading: boolean } {
  const chain = useChainOriginators();
  if (isPreview) return { originators: [FIXTURE_ORIGINATOR], isLoading: false };
  return chain;
}

export function useParams() {
  const chain = useChainParams();
  if (isPreview) return { params: FIXTURE_PARAMS, isLoading: false };
  return chain;
}

export function useLoanById(loanId: bigint | null) {
  const chain = useChainLoan(isPreview ? null : loanId);
  if (isPreview) {
    const loan = FIXTURE_LOANS.find((l) => l.id === loanId) ?? null;
    return { loan, isLoading: false, error: null };
  }
  return { loan: chain.loan, isLoading: chain.isLoading, error: (chain.error as Error) ?? null };
}

export function useOriginatorById(originatorId: bigint | null) {
  const chain = useChainOriginator(isPreview ? null : originatorId);
  if (isPreview) {
    return {
      originator: originatorId === FIXTURE_ORIGINATOR.id ? FIXTURE_ORIGINATOR : null,
      isLoading: false,
    };
  }
  return { originator: chain.originator, isLoading: chain.isLoading };
}

export interface FactWithLinks extends TransferFact {
  /** Present only for preview fixtures; on-chain facts do not store tx hashes. */
  txHash?: Hex;
  ccTxHash?: Hex;
}

/**
 * A stored fact.
 *
 * Note the asymmetry: fixtures carry the source-chain and Creditcoin transaction
 * hashes, but a fact read from the vault does NOT — the contract stores
 * (chainKey, blockHeight, txIndex, logIndex), not the hash. On a real deployment
 * the hash is recovered from the TransferFactStored event or the worker's index,
 * and until that path exists the UI shows the coordinates it genuinely has
 * rather than inventing a hash.
 */
export function useFactById(factId: Hex | null): {
  fact: FactWithLinks | null;
  exists: boolean;
  isLoading: boolean;
} {
  const chain = useChainFact(isPreview ? null : factId);

  return useMemo(() => {
    if (isPreview) {
      if (!factId) return { fact: null, exists: false, isLoading: false };
      const f: FixtureFact | undefined = FIXTURE_FACT_INDEX[factId.toLowerCase()];
      return { fact: f ?? null, exists: !!f, isLoading: false };
    }
    return { fact: chain.fact, exists: chain.exists, isLoading: chain.isLoading };
  }, [factId, chain.fact, chain.exists, chain.isLoading]);
}

export function useFactConsumer(factId: Hex | null): bigint | null {
  if (isPreview) {
    if (!factId) return null;
    return FIXTURE_FACT_CONSUMED_BY[factId.toLowerCase()] ?? 0n;
  }
  return null;
}

export function useBoundTreasuryOwner(address: Address | null) {
  const chain = useChainTreasuryOwner(isPreview ? null : address);
  if (isPreview) {
    return { originatorId: address ? fixtureTreasuryOwner(address) : null, isLoading: false };
  }
  return chain;
}
