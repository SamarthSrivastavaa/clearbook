'use client';

import { useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { useReadContract, useReadContracts, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

import { clearbookAbi, evidenceVaultAbi } from './abi';
import { contracts, isDeployed } from './config';
import { LoanStatus, type Loan, type Originator, type TransferFact } from './protocol';

/**
 * Chain reads.
 *
 * Note there is no multicall3 declared on this chain, so wagmi issues parallel
 * eth_calls rather than batching. That is fine at this scale and avoids
 * depending on a contract we have not verified exists.
 */

const clearbookContract = { address: contracts.clearbook ?? undefined, abi: clearbookAbi } as const;
const vaultContract = { address: contracts.evidenceVault ?? undefined, abi: evidenceVaultAbi } as const;

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useProtocolParameters() {
  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...clearbookContract, functionName: 'BOND_PER_LOAN' },
      { ...clearbookContract, functionName: 'SLASH_BPS' },
      { ...clearbookContract, functionName: 'BOUNTY_BPS' },
      { ...clearbookContract, functionName: 'REPAYMENT_BPS' },
      { ...clearbookContract, functionName: 'PROTOCOL_SINK' },
    ] as any,
    query: { enabled: isDeployed, staleTime: Infinity },
  });

  return useMemo(() => {
    if (!data) return { params: null, isLoading };
    const [bondPerLoan, slashBps, bountyBps, repaymentBps, protocolSink] = data;
    if (bondPerLoan.status !== 'success') return { params: null, isLoading };
    return {
      params: {
        bondPerLoan: bondPerLoan.result as bigint,
        slashBps: Number(slashBps.result ?? 0),
        bountyBps: Number(bountyBps.result ?? 0),
        repaymentBps: Number(repaymentBps.result ?? 0),
        protocolSink: protocolSink.result as Address,
      },
      isLoading,
    };
  }, [data, isLoading]);
}

export function useLoanCount() {
  const { data, isLoading, error } = useReadContract({
    ...clearbookContract,
    functionName: 'nextLoanId',
    query: { enabled: isDeployed },
  } as any);
  // Ids start at 1, so nextLoanId - 1 is the count.
  const count = typeof data === 'bigint' ? Number(data) - 1 : 0;
  return { count: Math.max(0, count), isLoading, error };
}

function toLoan(id: bigint, raw: readonly unknown[]): Loan {
  return {
    id,
    originatorId: raw[0] as bigint,
    token: raw[1] as Address,
    borrower: raw[2] as Address,
    principal: raw[3] as bigint,
    maturityBlock: raw[4] as bigint,
    disbursementFactId: raw[5] as Hex,
    repaymentFactId: raw[6] as Hex,
    claimBlock: raw[7] as bigint,
    status: Number(raw[8]) as LoanStatus,
  };
}

function toOriginator(id: bigint, raw: readonly unknown[]): Originator {
  return {
    id,
    owner: raw[0] as Address,
    name: raw[1] as string,
    bond: raw[2] as bigint,
    exposure: raw[3] as bigint,
    circularWindow: Number(raw[4]),
    challengeWindow: Number(raw[5]),
    lastClaimBlock: raw[6] as bigint,
    covenants: Number(raw[7]),
    active: Boolean(raw[8]),
  };
}

export function useLoans() {
  const { count, isLoading: countLoading, error: countError } = useLoanCount();

  const { data, isLoading, error } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      ...clearbookContract,
      functionName: 'loans',
      args: [BigInt(i + 1)],
    })) as any,
    query: { enabled: isDeployed && count > 0 },
  });

  const loans = useMemo(() => {
    if (!data) return [];
    return data
      .map((r, i) => (r.status === 'success' ? toLoan(BigInt(i + 1), r.result as readonly unknown[]) : null))
      .filter((l): l is Loan => l !== null && l.status !== LoanStatus.NONE);
  }, [data]);

  return { loans, isLoading: countLoading || isLoading, error: countError ?? error };
}

export function useLoan(loanId: bigint | null) {
  const { data, isLoading, error } = useReadContract({
    ...clearbookContract,
    functionName: 'loans',
    args: loanId !== null ? [loanId] : undefined,
    query: { enabled: isDeployed && loanId !== null },
  } as any);

  const loan = useMemo(() => {
    if (!data || loanId === null) return null;
    const l = toLoan(loanId, data as readonly unknown[]);
    return l.status === LoanStatus.NONE ? null : l;
  }, [data, loanId]);

  return { loan, isLoading, error };
}

export function useOriginator(originatorId: bigint | null) {
  const { data, isLoading, error } = useReadContract({
    ...clearbookContract,
    functionName: 'originators',
    args: originatorId !== null ? [originatorId] : undefined,
    query: { enabled: isDeployed && originatorId !== null && originatorId > 0n },
  } as any);

  const originator = useMemo(() => {
    if (!data || originatorId === null) return null;
    return toOriginator(originatorId, data as readonly unknown[]);
  }, [data, originatorId]);

  return { originator, isLoading, error };
}

export function useOriginators() {
  const { data: nextId } = useReadContract({
    ...clearbookContract,
    functionName: 'nextOriginatorId',
    query: { enabled: isDeployed },
  } as any);

  const count = typeof nextId === 'bigint' ? Math.max(0, Number(nextId) - 1) : 0;

  const { data, isLoading } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      ...clearbookContract,
      functionName: 'originators',
      args: [BigInt(i + 1)],
    })) as any,
    query: { enabled: isDeployed && count > 0 },
  });

  const originators = useMemo(() => {
    if (!data) return [];
    return data
      .map((r, i) => (r.status === 'success' ? toOriginator(BigInt(i + 1), r.result as readonly unknown[]) : null))
      .filter((o): o is Originator => o !== null && o.owner !== '0x0000000000000000000000000000000000000000');
  }, [data]);

  return { originators, isLoading };
}

export function toFact(raw: readonly unknown[] | Record<string, unknown>): TransferFact {
  const r = raw as any;
  const get = (i: number, k: string) => (Array.isArray(raw) ? raw[i] : r[k]);
  return {
    chainKey: get(0, 'chainKey') as bigint,
    blockHeight: get(1, 'blockHeight') as bigint,
    txIndex: get(2, 'txIndex') as bigint,
    logIndex: Number(get(3, 'logIndex')),
    token: get(4, 'token') as Address,
    from: get(5, 'from') as Address,
    to: get(6, 'to') as Address,
    amount: get(7, 'amount') as bigint,
    submitter: get(8, 'submitter') as Address,
    ccBlock: get(9, 'ccBlock') as bigint,
  };
}

/** Reads a stored fact. Returns null when the vault has never seen it. */
export function useFact(factId: Hex | null) {
  const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const enabled = isDeployed && !!factId && factId !== zero;

  const { data: present } = useReadContract({
    ...vaultContract,
    functionName: 'exists',
    args: factId ? [factId] : undefined,
    query: { enabled },
  } as any);

  const { data, isLoading, error } = useReadContract({
    ...vaultContract,
    functionName: 'getFact',
    args: factId ? [factId] : undefined,
    query: { enabled: enabled && present === true },
  } as any);

  const fact = useMemo(() => (data ? toFact(data as any) : null), [data]);
  return { fact, exists: present === true, isLoading, error };
}

/** Which originator, if any, bound this source-chain address. Zero means none. */
export function useTreasuryOwner(address: Address | null) {
  const { data, isLoading } = useReadContract({
    ...clearbookContract,
    functionName: 'treasuryOwner',
    args: address ? [address] : undefined,
    query: { enabled: isDeployed && !!address },
  } as any);

  return { originatorId: typeof data === 'bigint' ? data : null, isLoading };
}

/**
 * The evidence that proved a breach.
 *
 * The funding fact id is not stored on the Loan struct — it exists only in the
 * CovenantBreached event — so a breached loan cannot show the evidence that
 * convicted it without reading the log. The event shape is taken from the ABI
 * rather than retyped, so the topic hash cannot drift from the contract.
 *
 * `claimBlock` is a sound lower bound: a challenge cannot precede the claim it
 * challenges, which keeps the log range small on a chain with no indexer.
 */
const covenantBreachedEvent = (clearbookAbi as any).find(
  (e: any) => e.type === 'event' && e.name === 'CovenantBreached',
);

export interface BreachEvidence {
  fundingFactId: Hex;
  challenger: Address;
  txHash: Hex;
  block: bigint;
}

export function useBreachEvidence(loanId: bigint | null, fromBlock: bigint | null) {
  const client = usePublicClient();
  const enabled =
    isDeployed && !!client && !!contracts.clearbook && loanId !== null && fromBlock !== null;

  const { data, isLoading } = useQuery({
    queryKey: ['covenant-breached', loanId?.toString(), fromBlock?.toString()],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<BreachEvidence | null> => {
      const logs = await client!.getLogs({
        address: contracts.clearbook!,
        event: covenantBreachedEvent,
        args: { loanId: loanId! },
        fromBlock: fromBlock!,
        toBlock: 'latest',
      } as any);
      const last: any = logs[logs.length - 1];
      if (!last) return null;
      return {
        fundingFactId: last.args.fundingFactId as Hex,
        challenger: last.args.challenger as Address,
        txHash: last.transactionHash as Hex,
        block: last.blockNumber as bigint,
      };
    },
  });

  return { breach: data ?? null, isLoading: enabled && isLoading };
}

/**
 * Every fact currently citable from the vault.
 *
 * There is no indexer on this chain and the vault keeps no enumerable list, so
 * discovery goes through the TransferFactStored log. The lookback is bounded
 * because an unbounded getLogs is slow here (a 20k-block span costs a few
 * seconds); anything older can still be cited by pasting its identifier, so the
 * bound limits discovery, never what a challenger is allowed to do.
 */
const transferFactStoredEvent = (evidenceVaultAbi as any).find(
  (e: any) => e.type === 'event' && e.name === 'TransferFactStored',
);

export const VAULT_LOOKBACK_BLOCKS = 20_000n;

export interface VaultFact {
  factId: Hex;
  /** Which source chain this fact came from, as the precompile keys it. */
  chainKey: number;
  blockHeight: bigint;
  txIndex: bigint;
  /** Transaction-local: an index into this receipt's own log array. */
  logIndex: number;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

export function useVaultFacts() {
  const client = usePublicClient();
  const enabled = isDeployed && !!client && !!contracts.evidenceVault;

  const { data, isLoading } = useQuery({
    queryKey: ['vault-facts'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<VaultFact[]> => {
      const latest = await client!.getBlockNumber();
      const from = latest > VAULT_LOOKBACK_BLOCKS ? latest - VAULT_LOOKBACK_BLOCKS : 0n;
      const logs = await client!.getLogs({
        address: contracts.evidenceVault!,
        event: transferFactStoredEvent,
        fromBlock: from,
        toBlock: 'latest',
      } as any);
      return logs.map((l: any) => ({
        factId: l.args.factId as Hex,
        chainKey: Number(l.args.chainKey),
        blockHeight: l.args.blockHeight as bigint,
        txIndex: l.args.txIndex as bigint,
        logIndex: Number(l.args.logIndex),
        token: l.args.token as Address,
        from: l.args.from as Address,
        to: l.args.to as Address,
        amount: l.args.amount as bigint,
      }));
    },
  });

  return { facts: data ?? [], isLoading: enabled && isLoading };
}

/**
 * Which claim, if any, has consumed each fact.
 *
 * `factConsumedBy` is the registry's load-bearing read: it is what makes
 * "this evidence is spent" a fact about chain state rather than a label this
 * application applied. A returned 0 means unconsumed; any other value is the
 * loan id that committed it.
 *
 * Batched as parallel eth_calls — there is no multicall3 on this chain
 * (see the note at the top of this file), which is fine at registry scale.
 */
export function useFactConsumers(factIds: Hex[]): {
  consumers: Map<string, bigint>;
  isLoading: boolean;
} {
  const { data, isLoading } = useReadContracts({
    contracts: factIds.map((id) => ({
      ...clearbookContract,
      functionName: 'factConsumedBy',
      args: [id],
    })) as any,
    query: { enabled: isDeployed && !!contracts.clearbook && factIds.length > 0 },
  });

  return useMemo(() => {
    const consumers = new Map<string, bigint>();
    if (data) {
      factIds.forEach((id, i) => {
        const r = data[i];
        // A failed read is not "unconsumed" — leaving it absent keeps the
        // difference between "no claim" and "we could not tell" visible.
        if (r && r.status === 'success') consumers.set(id.toLowerCase(), r.result as bigint);
      });
    }
    return { consumers, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, factIds.join(',')]);
}
