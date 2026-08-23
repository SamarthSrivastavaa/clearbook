import Link from 'next/link';

import { PRECOMPILES, SOURCE_CHAINS, contracts, creditcoin, explorer } from '@/lib/config';
import { shortAddress } from '@/lib/format';

/**
 * The site footer.
 *
 * Every entry points at something that exists. There are no social accounts,
 * no careers page, no blog and no support desk, so none are listed — a footer
 * padded with dead links is the cheapest possible way to look bigger than you
 * are, and this product's entire argument is against overstating itself.
 *
 * What it does carry is the thing a reader might actually want at the bottom of
 * a page: where the contracts are, which chains are attested, and where the
 * documentation for any of it lives.
 */

const PRODUCT: Array<[string, string]> = [
  ['Credit book', '/book'],
  ['Evidence registry', '/registry'],
  ['Challenge console', '/challenge'],
  ['Verify a transaction', '/verify'],
];

const DOCUMENTATION: Array<[string, string]> = [
  ['Introduction', '/docs'],
  ['How it works', '/docs/how-it-works'],
  ['Concepts', '/docs/concepts'],
  ['Reference', '/docs/reference'],
];

const PROTOCOL: Array<[string, string]> = [
  ['Contracts', '/docs/protocol'],
  ['Covenant predicate', '/docs/covenant-predicate'],
  ['Enforcement', '/docs/enforcement'],
  ['Invariants', '/docs/invariants'],
];

const BOUNDARIES: Array<[string, string]> = [
  ['What Clearbook proves', '/docs/proves'],
  ['Limitations', '/docs/limitations'],
  ['Security', '/docs/security'],
  ['Verification pipeline', '/docs/verification'],
];

export function Footer() {
  const chains = Object.values(SOURCE_CHAINS).sort((a, b) => a.chainKey - b.chainKey);

  return (
    <footer className="band-deep relative isolate mt-20 border-t-2 border-ink">
      <div className="band-grid band-grid-fade absolute inset-0 -z-10" aria-hidden />

      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          {/* --- identity and live network --- */}
          <div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[17px] font-semibold tracking-tight text-onDeep">Clearbook</span>
              <span className="eyebrow">Evidence-bound credit</span>
            </div>

            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-onDeepMuted">
              Shared, cryptographically verified evidence for private-credit claims.
            </p>

            <dl className="mt-8 space-y-3 border-t border-[#2e2c25] pt-6">
              <FooterAddress label="EvidenceVault" address={contracts.evidenceVault} />
              <FooterAddress label="Clearbook" address={contracts.clearbook} />
              <FooterAddress label="Block Prover" address={PRECOMPILES.blockProver} />
              <FooterAddress label="ChainInfo" address={PRECOMPILES.chainInfo} />
            </dl>
          </div>

          {/* --- navigation --- */}
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            <FooterColumn title="Product" items={PRODUCT} />
            <FooterColumn title="Documentation" items={DOCUMENTATION} />
            <FooterColumn title="Protocol" items={PROTOCOL} />
            <FooterColumn title="Boundaries" items={BOUNDARIES} />
          </div>
        </div>

        {/* --- networks --- */}
        <div className="mt-14 grid gap-6 border-t border-[#2e2c25] pt-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="eyebrow">Deployed on</h3>
            <p className="mt-2 text-[13px] text-onDeep">
              {creditcoin.name}
              <span className="ml-2 text-onDeepMuted">chain {creditcoin.id}</span>
            </p>
          </div>

          <div className="lg:col-span-2">
            <h3 className="eyebrow">Source chains attested</h3>
            <ul className="mt-2 flex flex-wrap gap-x-8 gap-y-1.5">
              {chains.map((c) => (
                <li key={c.chainKey} className="text-[13px] text-onDeep">
                  {c.name}
                  <span className="ml-2 font-mono text-[12px] text-onDeepMuted">
                    key {c.chainKey}
                  </span>
                  {c.live ? (
                    <span className="ml-2 text-[11px] text-onDeepVerified">real value</span>
                  ) : (
                    <span className="ml-2 text-[11px] text-onDeepMuted">testnet</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* --- the standing disclaimer, kept verbatim --- */}
      <div className="border-t border-[#2e2c25]">
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          <p className="max-w-4xl text-[11px] leading-relaxed text-onDeepMuted">
            Clearbook verifies that a transaction was included in an attested source-chain block and
            that its receipt succeeded. It does not establish intent, control of any address by any
            person or entity, the existence of an off-chain agreement, or any violation of law.
          </p>
          <p className="mt-3 text-[11px] text-onDeepMuted">
            Deployed to testnet. Nothing here custodies real value.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map(([label, href]) => (
          <li key={href}>
            <Link
              href={href}
              className="text-[13px] leading-snug text-onDeepMuted transition-colors hover:text-onDeep"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An address is only listed when it actually exists in configuration. */
function FooterAddress({ label, address }: { label: string; address: string | null }) {
  if (!address) return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-onDeepMuted">{label}</dt>
      <dd>
        <a
          href={explorer.ccAddress(address)}
          target="_blank"
          rel="noreferrer noopener"
          title={address}
          className="font-mono text-[12px] text-onDeep underline decoration-[#4a4638] underline-offset-4 transition-colors hover:decoration-onDeep"
        >
          {shortAddress(address)}
        </a>
      </dd>
    </div>
  );
}
