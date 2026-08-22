'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SEARCH_INDEX, SECTIONS, PAGES, docHref } from '@/lib/docs';

/**
 * Documentation navigation and search.
 *
 * Search runs entirely in the browser over an index built at module load. The
 * corpus is small enough that shipping it whole beats adding a search service,
 * and it means search works with no network round trip and no third party.
 */

export function DocsNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation">
      <DocsSearch onNavigate={onNavigate} />

      <div className="mt-7 space-y-7">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="eyebrow">{section.title}</h3>
            <ul className="mt-2.5 space-y-px">
              {section.pages.map((slug) => {
                const page = PAGES.get(slug);
                if (!page) return null;
                const href = docHref(slug);
                const active = pathname === href;
                return (
                  <li key={slug}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`block border-l py-1.5 pl-3 text-[13px] leading-snug transition-colors ${
                        active
                          ? 'border-l-accent font-medium text-ink'
                          : 'border-l-rule text-muted hover:border-l-rule-strong hover:text-ink'
                      }`}
                    >
                      {page.slug === '' ? 'Introduction' : page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function DocsSearch({ onNavigate }: { onNavigate?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    return SEARCH_INDEX.map((e) => {
      // Title and summary hits outrank a mention buried in prose.
      let score = 0;
      if (e.title.toLowerCase().includes(term)) score += 10;
      if (e.summary.toLowerCase().includes(term)) score += 5;
      if (e.body.includes(term)) score += 1;
      return { e, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 7)
      .map((r) => r.e);
  }, [q]);

  // Dismiss on outside click, so the panel never strands the reader.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="sr-only" htmlFor="docs-search">
        Search documentation
      </label>
      <input
        id="docs-search"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search"
        className="w-full border border-rule bg-surface px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-faint focus:border-rule-strong"
      />

      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto border border-rule bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-faint">
              Nothing matches “{q.trim()}”.
            </p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={docHref(r.slug)}
                    onClick={() => {
                      setOpen(false);
                      setQ('');
                      onNavigate?.();
                    }}
                    className="block border-b border-rule px-3 py-2.5 transition-colors last:border-b-0 hover:bg-sunken"
                  >
                    <span className="block text-[13px] font-medium">{r.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                      {r.summary}
                    </span>
                    <span className="eyebrow mt-1 block">{r.section}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Mobile: the same nav behind a disclosure. */
export function DocsNavMobile() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-rule py-3 text-[13px]"
      >
        <span className="eyebrow">Documentation</span>
        <span aria-hidden className="text-faint">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="border-b border-rule py-5">
          <DocsNav onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
