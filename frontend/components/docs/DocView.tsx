import Link from 'next/link';

import { Blocks } from './Blocks';
import { Eyebrow } from '@/components/ui';
import { docHref, neighbours, outline } from '@/lib/docs';
import type { DocPage } from '@/lib/docs/types';

/**
 * One documentation page: title, content, outline, and where to go next.
 *
 * The outline sits in a third column on wide screens and is omitted entirely
 * when a page has fewer than two headings — an outline listing one item is
 * furniture, not navigation.
 */
export function DocView({ page }: { page: DocPage }) {
  const headings = outline(page);
  const { prev, next } = neighbours(page.slug);
  const showOutline = headings.length >= 2;

  return (
    <div
      className={
        showOutline
          ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,180px)] xl:gap-10'
          : undefined
      }
    >
      <article className="min-w-0 pb-16">
        <header>
          {page.audience ? <Eyebrow>{page.audience}</Eyebrow> : null}
          <h1 className="display-lg mt-2">{page.title}</h1>
        </header>

        <Blocks blocks={page.blocks} />

        {(prev || next) && (
          <nav
            aria-label="Page navigation"
            className="mt-14 grid gap-px border-t border-rule bg-rule pt-px sm:grid-cols-2"
          >
            {prev ? (
              <Link href={docHref(prev.slug)} className="bg-paper py-5 transition-colors hover:bg-sunken">
                <span className="eyebrow">Previous</span>
                <span className="mt-1.5 block text-[14px] font-medium">
                  {prev.slug === '' ? 'Introduction' : prev.title}
                </span>
              </Link>
            ) : (
              <span className="bg-paper" />
            )}
            {next ? (
              <Link
                href={docHref(next.slug)}
                className="bg-paper py-5 text-right transition-colors hover:bg-sunken"
              >
                <span className="eyebrow">Next</span>
                <span className="mt-1.5 block text-[14px] font-medium">{next.title}</span>
              </Link>
            ) : (
              <span className="bg-paper" />
            )}
          </nav>
        )}
      </article>

      {showOutline ? (
        <aside className="hidden xl:block">
          <div className="sticky top-24 pt-16">
            <Eyebrow>On this page</Eyebrow>
            <ul className="mt-3 space-y-2">
              {headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="block text-[12px] leading-snug text-muted transition-colors hover:text-ink"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
