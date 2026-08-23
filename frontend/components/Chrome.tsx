'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAccount, useBlockNumber, useChainId, useConnect, useDisconnect } from 'wagmi';

import { DEMO_MODE, contracts, creditcoin, explorer, isDeployed } from '@/lib/config';
import { shortAddress, formatBlock } from '@/lib/format';

/**
 * The application chrome: a single thin status bar.
 *
 * Deliberately not a sidebar. A sidebar would make this look like every admin
 * template; a status bar makes it read as an instrument — and it puts the two
 * things that establish trust (which chain, which contracts) permanently in
 * view rather than buried in a settings page.
 */

const ROUTES = [
  { href: '/book', label: 'Book' },
  { href: '/registry', label: 'Registry' },
  { href: '/challenge', label: 'Challenge' },
  { href: '/verify', label: 'Verify' },
  { href: '/docs', label: 'Docs' },
];

function NetworkState() {
  const chainId = useChainId();
  const { data: block } = useBlockNumber({ watch: true, query: { refetchInterval: 12_000 } });
  const right = chainId === creditcoin.id;

  return (
    <div className="flex shrink-0 items-center gap-4">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 ${right ? 'bg-verified' : 'bg-breach'}`}
          aria-hidden
        />
        <span className="text-[11px] text-muted">
          {right ? 'Creditcoin CC3' : `Wrong network (${chainId})`}
        </span>
      </span>
      {block ? (
        <span className="ident tnum hidden text-[11px] md:inline" title="Creditcoin block height">
          #{formatBlock(block)}
        </span>
      ) : null}
    </div>
  );
}

function Wallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors[0];

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="ident text-[11px] transition-colors hover:text-ink"
        title={`${address} — click to disconnect`}
      >
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => injectedConnector && connect({ connector: injectedConnector })}
      disabled={isPending || !injectedConnector}
      className="text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-ink disabled:opacity-40"
    >
      {isPending ? 'Connecting…' : injectedConnector ? 'Connect wallet' : 'No wallet detected'}
    </button>
  );
}

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 overflow-x-auto px-6 sm:gap-10">
          {/* Wordmark only. The tagline used to sit beside it at eyebrow size,
              which read as a second, competing label rather than a subtitle —
              it lives in the hero and the footer, where it has room. The mark
              is the rail motif: one thing above, one below, joined. */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Clearbook home">
            <span className="flex flex-col gap-[3px]" aria-hidden>
              <span className="block h-[7px] w-[7px] bg-signal" />
              <span className="block h-[7px] w-[7px] bg-ink" />
            </span>
            <span className="text-[16px] font-semibold tracking-tight">Clearbook</span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1" aria-label="Primary">
            {ROUTES.map((r) => {
              const active =
                r.href === '/book'
                  ? pathname === '/book' || pathname.startsWith('/loan')
                  : pathname.startsWith(r.href);
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex h-14 items-center px-3 text-[13px] font-medium transition-colors ${
                    active ? 'text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {r.label}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-2 bottom-0 h-[2px] bg-ink"
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-4 sm:gap-5">
            <NetworkState />
            <Wallet />
          </div>
        </div>

        {/* Contract identity stays permanently visible: the product's whole claim
            is that these are verifiable, so they are never more than a glance away. */}
        <div className="border-t border-rule bg-sunken">
          <div className="mx-auto flex h-8 max-w-[1400px] items-center gap-6 overflow-x-auto px-6">
            {isDeployed ? (
              <>
                <ContractRef label="EvidenceVault" address={contracts.evidenceVault!} />
                <ContractRef label="Clearbook" address={contracts.clearbook!} />
              </>
            ) : (
              <span className="text-[11px] text-pending">
                Contracts not deployed — set NEXT_PUBLIC_EVIDENCE_VAULT_ADDRESS and
                NEXT_PUBLIC_CLEARBOOK_ADDRESS
              </span>
            )}
            {DEMO_MODE ? (
              <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wider text-pending">
                Demo mode · transactions staged by us
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className={isLanding ? 'pt-10' : 'mx-auto max-w-[1400px] px-6 py-10'}>{children}</main>

      {/* The landing page renders the full footer itself. Everywhere else keeps
          the standing disclaimer: it is a truthfulness guardrail, not decoration,
          and dropping it from the app screens would be the wrong economy. */}
      {pathname === '/' ? null : (
        <footer className="mt-16 border-t border-rule">
          <div className="mx-auto max-w-[1400px] px-6 py-6 text-[11px] leading-relaxed text-faint">
            Clearbook verifies that a transaction was included in an attested source-chain block and
            that its receipt succeeded. It does not establish intent, control of any address by any
            person or entity, the existence of an off-chain agreement, or any violation of law.
          </div>
        </footer>
      )}
    </div>
  );
}

function ContractRef({ label, address }: { label: string; address: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-2">
      <span className="eyebrow">{label}</span>
      <a
        href={explorer.ccAddress(address)}
        target="_blank"
        rel="noreferrer noopener"
        className="ident ident-link text-[11px]"
        title={address}
      >
        {shortAddress(address)}
      </a>
    </span>
  );
}
