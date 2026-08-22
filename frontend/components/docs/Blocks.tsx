import Link from 'next/link';
import type { ReactNode } from 'react';

import { headingId } from '@/lib/docs';
import type { Block, Tone } from '@/lib/docs/types';

/**
 * Block renderers.
 *
 * One component per block type, so a table on the security page cannot drift
 * from a table on the reference page. Everything inherits the product's design
 * tokens — the documentation is the same system, not a themed lookalike.
 */

// --- inline formatting: **bold**, `code`, [text](href) ---

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

export function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE).filter(Boolean);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-medium text-ink">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="ident rounded-[2px] bg-sunken px-1 py-px text-[0.92em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          const [, label, href] = link;
          const external = href.startsWith('http');
          return external ? (
            <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="link">
              {label}
            </a>
          ) : (
            <Link key={i} href={href} className="link">
              {label}
            </Link>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ink',
  verified: 'text-verified',
  breach: 'text-breach',
  pending: 'text-pending',
};

const TONE_RULE: Record<Tone, string> = {
  default: 'border-l-rule-strong',
  verified: 'border-l-verified',
  breach: 'border-l-breach',
  pending: 'border-l-pending',
};

const TONE_DOT: Record<Tone, string> = {
  default: 'bg-rule-strong',
  verified: 'bg-verified',
  breach: 'bg-breach',
  pending: 'bg-pending',
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.t) {
    case 'lead':
      return (
        <p className="prose-lead mt-5 max-w-2xl">
          <Inline text={block.text} />
        </p>
      );

    case 'h':
      return (
        <h2
          id={headingId(block.text)}
          className="display-md mt-14 scroll-mt-28 border-t border-rule pt-7 first:mt-10"
        >
          {block.text}
        </h2>
      );

    case 'p':
      return (
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-muted">
          <Inline text={block.text} />
        </p>
      );

    case 'list':
      return block.ordered ? (
        <ol className="mt-4 max-w-2xl space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-muted">
              <span className="ident shrink-0 pt-px text-[11px] text-faint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mt-4 max-w-2xl space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-muted">
              <span aria-hidden className="select-none pt-0.5 text-faint">
                —
              </span>
              <span>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ul>
      );

    case 'code':
      return (
        <figure className="artifact mt-5 max-w-3xl overflow-hidden">
          {block.caption ? (
            <figcaption className="artifact-bar">
              <span className="eyebrow">{block.caption}</span>
              <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-faint">
                {block.lang}
              </span>
            </figcaption>
          ) : null}
          <pre className="overflow-x-auto px-5 py-4">
            <code className="font-mono text-[12.5px] leading-relaxed">{block.code}</code>
          </pre>
        </figure>
      );

    case 'note': {
      const tone = block.tone ?? 'default';
      return (
        <aside
          className={`mt-6 max-w-2xl border-l-2 bg-sunken px-5 py-4 ${TONE_RULE[tone]}`}
        >
          {block.title ? (
            <p className={`text-[13px] font-medium ${TONE_TEXT[tone]}`}>{block.title}</p>
          ) : null}
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            <Inline text={block.text} />
          </p>
        </aside>
      );
    }

    case 'table':
      return (
        <div className="mt-6 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="rule-b">
                {block.head.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="py-2.5 pr-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="rule-b align-top">
                  {row.map((cell, j) => (
                    <td key={j} className="py-3 pr-6 text-[13px] leading-relaxed text-muted">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'split':
      return (
        <div className="mt-6 grid gap-px bg-rule lg:grid-cols-2">
          <div className="bg-paper p-6">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-[2px] bg-verified" aria-hidden />
              <h3 className="text-[13px] font-medium text-verified">
                {block.canTitle ?? 'Establishes'}
              </h3>
            </div>
            <ul className="mt-4 space-y-2.5">
              {block.can.map((c, i) => (
                <li key={i} className="text-[13px] leading-relaxed">
                  <Inline text={c} />
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-paper p-6">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-[2px] bg-breach" aria-hidden />
              <h3 className="text-[13px] font-medium text-breach">
                {block.cannotTitle ?? 'Does not establish'}
              </h3>
            </div>
            <ul className="mt-4 space-y-2.5">
              {block.cannot.map((c, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-muted">
                  <Inline text={c} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      );

    case 'flow':
      return (
        <ol className="rail mt-6 max-w-2xl">
          {block.steps.map((s, i) => (
            <li
              key={i}
              className="rail-node pb-6 last:pb-0"
              data-state={s.tone === 'breach' ? 'breach' : s.tone === 'verified' ? 'done' : undefined}
            >
              <div className="text-[14px] font-medium">
                <Inline text={s.label} />
              </div>
              {s.sub ? (
                <div className="mt-1 text-[13px] leading-relaxed text-muted">
                  <Inline text={s.sub} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      );

    case 'defs':
      return (
        <dl className="mt-6 max-w-2xl">
          {block.items.map((d, i) => (
            <div key={i} className="border-t border-rule py-5 first:border-t-0 first:pt-0">
              <dt className="statement">{d.term}</dt>
              <dd className="mt-2 text-[14px] leading-relaxed">
                <Inline text={d.simple} />
              </dd>
              {d.technical ? (
                <dd className="interpretation mt-3">
                  <p className="text-[13px] leading-relaxed text-muted">
                    <Inline text={d.technical} />
                  </p>
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      );

    case 'next':
      // Column count follows item count. A fixed three-column grid leaves the
      // rule background showing through as a filled cell when there are two.
      return (
        <nav
          className={`mt-8 grid gap-px bg-rule ${
            block.items.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
          }`}
        >
          {block.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group bg-paper p-5 transition-colors hover:bg-sunken"
            >
              <span className="flex items-baseline gap-2 text-[14px] font-medium">
                {item.label}
                <span
                  aria-hidden
                  className="text-faint transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </span>
              {item.sub ? (
                <span className="mt-1 block text-[12px] leading-relaxed text-muted">{item.sub}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      );
  }
}

export { TONE_DOT };
