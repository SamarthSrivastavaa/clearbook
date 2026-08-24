/**
 * The documentation content model.
 *
 * Pages are structured data rather than MDX. Three reasons, in order of how
 * much they mattered:
 *
 *   1. Every internal link can be validated against the page registry at build
 *      time, so the docs cannot ship a dead link.
 *   2. No new dependency, no second build pipeline, no risk to the app's build.
 *   3. Blocks render through one set of components, so a table on the security
 *      page cannot drift from a table on the reference page.
 *
 * The cost is that prose lives in TypeScript strings. Inline formatting keeps
 * that bearable: **bold**, `code`, and [text](/docs/slug).
 */

export type Tone = 'default' | 'verified' | 'breach' | 'pending';

export type Block =
  /** A section heading. Feeds the on-page outline. */
  | { t: 'h'; text: string }
  /** A paragraph. Supports inline **bold**, `code`, and [links](/docs/x). */
  | { t: 'p'; text: string }
  /** A lead paragraph. One per page, directly under the title. */
  | { t: 'lead'; text: string }
  | { t: 'list'; items: string[]; ordered?: boolean }
  | { t: 'code'; lang: string; code: string; caption?: string }
  | { t: 'note'; tone?: Tone; title?: string; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  /** The can/cannot composition. Used where the boundary is the point. */
  | { t: 'split'; canTitle?: string; can: string[]; cannotTitle?: string; cannot: string[] }
  /** A vertical flow diagram on the provenance rail. */
  | { t: 'flow'; steps: Array<{ label: string; sub?: string; tone?: Tone }> }
  /** Term definitions: one plain sentence, then the technical one. */
  | { t: 'defs'; items: Array<{ term: string; simple: string; technical?: string }> }
  /** Links onward. Never leave a reader at a dead end. */
  | { t: 'next'; items: Array<{ href: string; label: string; sub?: string }> };

export interface DocPage {
  /** Path under /docs. Empty string is the docs homepage. */
  slug: string;
  title: string;
  /** One sentence. Used in nav tooltips, search, and page metadata. */
  summary: string;
  /** Which audience this page is written for, shown as an eyebrow. */
  audience?: 'Judges' | 'Users' | 'Developers' | 'Everyone';
  blocks: Block[];
}

export interface DocSection {
  title: string;
  /** Slugs, in order. Every slug must resolve to a page. */
  pages: string[];
}
