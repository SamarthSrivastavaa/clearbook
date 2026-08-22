import type { Block, DocPage, DocSection } from './types';
import { startPages } from './content/start';
import { productPages } from './content/product';
import { rationalePages } from './content/rationale';
import { technicalPages } from './content/technical';
import { protocolPages } from './content/protocol';
import { referencePages } from './content/reference';

export type { Block, DocPage, DocSection } from './types';

const ALL: DocPage[] = [
  ...startPages,
  ...productPages,
  ...rationalePages,
  ...technicalPages,
  ...protocolPages,
  ...referencePages,
];

export const PAGES = new Map(ALL.map((p) => [p.slug, p]));

/**
 * Navigation. Order is editorial, not alphabetical — it is the order a reader
 * who knows nothing should meet these ideas in.
 */
export const SECTIONS: DocSection[] = [
  { title: 'Introduction', pages: ['', 'overview', 'how-it-works', 'concepts'] },
  {
    title: 'Product',
    pages: ['evidence-registry', 'duplicate-commitment', 'claims', 'covenants', 'challenges'],
  },
  {
    title: 'Protocol',
    pages: ['protocol', 'covenant-predicate', 'enforcement', 'state-machine', 'invariants'],
  },
  { title: 'Verification', pages: ['verification', 'source-chains'] },
  { title: 'Architecture', pages: ['architecture', 'security'] },
  { title: 'Boundaries', pages: ['proves', 'limitations'] },
  { title: 'Rationale', pages: ['why-attestcoin', 'why-creditcoin', 'why-not-a-database'] },
  { title: 'Reference', pages: ['reference'] },
];

export function getPage(slug: string): DocPage | undefined {
  return PAGES.get(slug);
}

export function docHref(slug: string): string {
  return slug === '' ? '/docs' : `/docs/${slug}`;
}

/** Every page in nav order, for previous/next links. */
export const ORDERED: DocPage[] = SECTIONS.flatMap((s) =>
  s.pages.map((slug) => PAGES.get(slug)).filter((p): p is DocPage => !!p),
);

export function neighbours(slug: string): { prev?: DocPage; next?: DocPage } {
  const i = ORDERED.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { prev: ORDERED[i - 1], next: ORDERED[i + 1] };
}

/** Headings in a page, for the on-page outline. */
export function outline(page: DocPage): Array<{ id: string; text: string }> {
  return page.blocks
    .filter((b): b is Extract<Block, { t: 'h' }> => b.t === 'h')
    .map((b) => ({ id: headingId(b.text), text: b.text }));
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Integrity checks
//
// These run when the module is first imported, which means during the build.
// A dead internal link or a nav entry pointing at a missing page fails the
// build rather than shipping — documentation that lies about its own structure
// is worse than documentation that is missing.
// ---------------------------------------------------------------------------

/** Pulls every `[text](href)` target out of a block's prose. */
function linksIn(block: Block): string[] {
  const texts: string[] = [];
  const push = (v?: string) => {
    if (v) texts.push(v);
  };

  switch (block.t) {
    case 'p':
    case 'lead':
      push(block.text);
      break;
    case 'note':
      push(block.text);
      break;
    case 'list':
      block.items.forEach(push);
      break;
    case 'table':
      block.rows.forEach((r) => r.forEach(push));
      break;
    case 'defs':
      block.items.forEach((d) => {
        push(d.simple);
        push(d.technical);
      });
      break;
    case 'split':
      block.can.forEach(push);
      block.cannot.forEach(push);
      break;
    case 'next':
      return block.items.map((i) => i.href);
    default:
      break;
  }

  const found: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) found.push(m[1]);
  }
  return found;
}

function validate(): void {
  const known = new Set(ALL.map((p) => docHref(p.slug)));
  const problems: string[] = [];

  // 1 · every nav entry resolves
  for (const section of SECTIONS) {
    for (const slug of section.pages) {
      if (!PAGES.has(slug)) problems.push(`nav "${section.title}" points at missing page "${slug}"`);
    }
  }

  // 2 · every page appears in nav exactly once
  const navSlugs = SECTIONS.flatMap((s) => s.pages);
  for (const page of ALL) {
    const n = navSlugs.filter((s) => s === page.slug).length;
    if (n === 0) problems.push(`page "${page.slug}" is not in any nav section`);
    if (n > 1) problems.push(`page "${page.slug}" appears in nav ${n} times`);
  }

  // 3 · every internal link resolves. External links are left alone.
  for (const page of ALL) {
    for (const block of page.blocks) {
      for (const href of linksIn(block)) {
        if (!href.startsWith('/docs')) continue;
        const [path] = href.split('#');
        if (!known.has(path)) {
          problems.push(`page "${page.slug || 'index'}" links to missing "${href}"`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Documentation integrity check failed:\n  - ${problems.join('\n  - ')}`);
  }
}

validate();

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchEntry {
  slug: string;
  title: string;
  summary: string;
  section: string;
  /** Flattened prose, lowercased, for substring matching. */
  body: string;
}

/** Plain text of a block, for the search index. */
function textOf(block: Block): string {
  switch (block.t) {
    case 'h':
    case 'p':
    case 'lead':
      return block.text;
    case 'note':
      return `${block.title ?? ''} ${block.text}`;
    case 'list':
      return block.items.join(' ');
    case 'code':
      return block.code;
    case 'table':
      return [...block.head, ...block.rows.flat()].join(' ');
    case 'split':
      return [...block.can, ...block.cannot].join(' ');
    case 'flow':
      return block.steps.map((s) => `${s.label} ${s.sub ?? ''}`).join(' ');
    case 'defs':
      return block.items.map((d) => `${d.term} ${d.simple} ${d.technical ?? ''}`).join(' ');
    case 'next':
      return block.items.map((i) => i.label).join(' ');
  }
}

/** Built once at module load; small enough to ship to the client whole. */
export const SEARCH_INDEX: SearchEntry[] = SECTIONS.flatMap((section) =>
  section.pages
    .map((slug) => PAGES.get(slug))
    .filter((p): p is DocPage => !!p)
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      section: section.title,
      body: [p.title, p.summary, ...p.blocks.map(textOf)]
        .join(' ')
        .replace(/[`*\[\]()]/g, ' ')
        .toLowerCase(),
    })),
);
