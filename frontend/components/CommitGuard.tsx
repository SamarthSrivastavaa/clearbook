'use client';

import { usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';

import { Eyebrow } from './ui';
import { clearbookAbi } from '@/lib/abi';
import { contracts, explorer, isDeployed } from '@/lib/config';
import { decodeRevert } from '@/lib/errors';

/**
 * The guard, demonstrated against the live contract.
 *
 * A rejected commitment leaves no event to read — a reverted transaction emits
 * nothing — so showing the refusal after the fact would mean this application
 * asserting it happened, which is exactly the kind of claim Clearbook exists to
 * avoid making.
 *
 * Instead this runs the call for real. `useSimulateContract` performs an
 * `eth_call` against the deployed Clearbook with a genuine already-consumed
 * factId, and the error rendered below is the one the contract returns. Nothing
 * here is mocked, pre-labelled, or branched on a string we chose: if the guard
 * were removed, this panel would report success.
 */
export function CommitGuard({
  factId,
  token,
  borrower,
  amount,
  otherOriginatorId,
  otherOriginatorName,
  otherOriginatorOwner,
  incumbentLoanId,
  recordedTxHash,
}: {
  factId: Hex;
  token: Address;
  borrower: Address;
  amount: bigint;
  /** An originator that does NOT already own this fact. */
  otherOriginatorId: bigint;
  otherOriginatorName: string;
  /** The address that owns that originator — the simulation runs as this. */
  otherOriginatorOwner: Address;
  incumbentLoanId: bigint;
  /** The reverted transaction we sent, for anyone who wants the receipt. */
  recordedTxHash?: string;
}) {
  const client = usePublicClient();

  // A plain eth_call through the public client rather than wagmi's
  // useSimulateContract: the latter is built around a connected account and
  // stays idle without a wallet, which is precisely the case here — this panel
  // must work for a reader who has connected nothing.
  const { data, error, isLoading } = useQuery({
    queryKey: ['commit-guard', factId, otherOriginatorId.toString()],
    enabled: isDeployed && !!client && !!contracts.clearbook,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      await client!.simulateContract({
        address: contracts.clearbook!,
        abi: clearbookAbi,
        functionName: 'registerLoan',
        // Run AS originator B's owner. `registerLoan` checks ownership before it
        // checks the fact, so simulating from any other sender would be refused
        // for the wrong reason and prove nothing about the guard under test.
        account: otherOriginatorOwner,
        args: [otherOriginatorId, token, borrower, amount, 9223372036854775807n, factId],
      });
      return 'accepted' as const;
    },
  });

  const decoded = error ? decodeRevert(error) : null;
  const refused = decoded?.name === 'FactAlreadyUsed';

  return (
    <div className="record mt-4 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Eyebrow>Duplicate commitment</Eyebrow>
        <span className="text-[11px] text-faint">simulated against the deployed contract, live</span>
      </div>

      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted">
        <span className="text-ink">{otherOriginatorName}</span> is a separate originator with its
        own owner and its own posted bond. This asks the contract, right now, whether it would let
        that originator commit this same fact to a claim of its own.
      </p>

      {isLoading ? (
        <p className="mt-4 text-[13px] text-faint">Asking Creditcoin…</p>
      ) : refused ? (
        <div className="mt-4">
          <p className="verdict verdict-breach">
            <span className="inline-block h-[0.9em] w-[3px] shrink-0 bg-breach" aria-hidden />
            FactAlreadyUsed
          </p>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed">
            The contract refuses. This fact is already committed to{' '}
            <span className="font-mono">L-{incumbentLoanId.toString().padStart(3, '0')}</span>, and{' '}
            <span className="tnum">no second claim can take it</span> — not by this originator, and
            not by any other.
          </p>
          {recordedTxHash ? (
            <p className="mt-3 text-[12px] text-faint">
              We also sent it as a real transaction, so the refusal has a receipt:{' '}
              <a
                href={explorer.ccTx(recordedTxHash)}
                target="_blank"
                rel="noreferrer noopener"
                className="ident ident-link"
              >
                reverted on-chain
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : data ? (
        // Reaching here means the guard did not fire. Say so plainly rather than
        // rendering a reassuring message that is not true.
        <p className="mt-4 text-[13px] leading-relaxed text-pending">
          The contract did not refuse this call. That is unexpected for a committed fact — treat the
          consumption state above as unconfirmed.
        </p>
      ) : (
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          The contract refused with{' '}
          <code className="font-mono text-[12px]">{decoded?.name ?? 'an unnamed error'}</code>
          {decoded?.name ? ', which is a different guard than the one being demonstrated here.' : '.'}
        </p>
      )}
    </div>
  );
}
