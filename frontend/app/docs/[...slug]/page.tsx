import { notFound } from 'next/navigation';

import { DocView } from '@/components/docs/DocView';
import { ORDERED, getPage } from '@/lib/docs';

/** Every page is known at build time, so all of them prerender. */
export function generateStaticParams() {
  return ORDERED.filter((p) => p.slug !== '').map((p) => ({ slug: p.slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = getPage(slug.join('/'));
  if (!page) return {};
  return { title: page.title, description: page.summary };
}

export default async function DocsPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = getPage(slug.join('/'));
  if (!page) notFound();
  return <DocView page={page} />;
}
