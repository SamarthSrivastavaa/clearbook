import type { Metadata } from 'next';

import { DocsNav, DocsNavMobile } from '@/components/docs/Nav';

/**
 * The documentation shell.
 *
 * Three columns on desktop: navigation, content, page outline. It nests inside
 * the application's own chrome deliberately — the docs are part of Clearbook,
 * not a separate site wearing its colours.
 */
export const metadata: Metadata = {
  title: { default: 'Clearbook documentation', template: '%s · Clearbook docs' },
  description:
    'Clearbook turns independently verified source-chain activity into shared evidence for credit claims, with immutable covenant enforcement on Creditcoin.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <DocsNavMobile />

      <div className="lg:grid lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pb-10 pr-2">
            <DocsNav />
          </div>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
