'use client';

import { useState, type ReactNode } from 'react';

import type { Tone } from '@/lib/protocol';
import { shortHash } from '@/lib/format';

/**
 * The Clearbook component vocabulary.
 *
 * Small on purpose. Every element here exists because the product needs it more
 * than once and because it carries meaning — there are no decorative primitives.
 */

const TONE_CLASS: Record<Tone, string> = {
  verified: 'text-verified',
  breach: 'text-breach',
  pending: 'text-pending',
  inert: 'text-inert',
};

const TONE_BG: Record<Tone, string> = {
  verified: 'bg-verified-soft',
  breach: 'bg-breach-soft',
  pending: 'bg-pending-soft',
  inert: 'bg-inert-soft',
};

/** A status is a rule and a word. Never a pill, never a dot. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

/** A titled region. Rules, not cards. */
export function Section({
  title,
  aside,
  children,
  className = '',
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
        <Eyebrow>{title}</Eyebrow>
        {aside ? <div className="text-[11px] text-faint">{aside}</div> : null}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

/** Label above value. The default way any single figure is presented. */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      <div className={`${mono ? 'font-mono text-[13px]' : 'text-sm'} tnum text-ink`}>
        {children}
      </div>
    </div>
  );
}

/**
 * A technical identifier: hash, address, or key. Always monospace, always
 * truncated in the middle, always linked to an explorer when one exists, always
 * copyable in full. §12 requires that no figure appears without a source.
 */
export function Ident({
  value,
  href,
  lead = 10,
  tail = 8,
  label,
}: {
  value: string;
  href?: string;
  lead?: number;
  tail?: number;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = shortHash(value, lead, tail);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable; the full value is still in the title attribute */
    }
  };

  return (
    <span className="inline-flex items-baseline gap-2">
      {href ? (
        <a
          className="ident ident-link"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={label ? `${label}: ${value}` : value}
        >
          {text}
        </a>
      ) : (
        <span className="ident" title={value}>
          {text}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? 'value'} in full`}
        className="text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-ink"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'quiet';
  type?: 'button' | 'submit';
  className?: string;
}) {
  // Weight comes from a hard offset shadow rather than colour: the palette is
  // reserved for protocol state, so an action cannot announce itself with hue.
  // Disabled buttons drop the shadow — an action that cannot be taken should
  // not look like it is sitting proud of the page.
  const base =
    'press inline-flex items-center justify-center gap-2 px-5 h-10 text-[13px] font-semibold tracking-[0.04em] border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';
  const variants = {
    primary: 'hard-sm bg-ink text-paper border-ink hover:bg-black disabled:hover:bg-ink',
    default: 'hard-rule bg-surface text-ink border-ink hover:bg-sunken',
    quiet: 'bg-transparent text-muted border-transparent hover:text-ink px-2 shadow-none',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  label,
  mono = true,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        className={`h-10 w-full border bg-surface px-3 text-[13px] text-ink placeholder:text-faint ${
          mono ? 'font-mono' : ''
        } ${invalid ? 'border-breach' : 'border-rule-strong'}`}
      />
    </label>
  );
}

/** A callout carrying protocol meaning. Used sparingly. */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`${TONE_BG[tone]} border-l-2 ${TONE_CLASS[tone]} px-4 py-3`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_CLASS[tone]}`}>
        {title}
      </div>
      {children ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-ink">{children}</div>
      ) : null}
    </div>
  );
}

/** Progressive disclosure for cryptographic internals. */
export function Disclosure({
  summary,
  children,
  count,
}: {
  summary: string;
  children: ReactNode;
  count?: string;
}) {
  return (
    <details className="group rule-t">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[12px] text-muted transition-colors hover:text-ink">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 text-faint transition-transform group-open:rotate-90">
            ›
          </span>
          {summary}
        </span>
        {count ? <span className="ident text-[11px]">{count}</span> : null}
      </summary>
      <div className="pb-4 pl-5">{children}</div>
    </details>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rule-t py-16 text-center">
      <div className="text-sm text-ink">{title}</div>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Working({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="animate-working h-3 w-px bg-ink" aria-hidden />
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}
