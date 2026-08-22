import { notFound } from 'next/navigation';

import { DocView } from '@/components/docs/DocView';
import { getPage } from '@/lib/docs';

export function generateMetadata() {
  const page = getPage('');
  return { title: 'Clearbook documentation', description: page?.summary };
}

export default function DocsIndexPage() {
  const page = getPage('');
  if (!page) notFound();
  return <DocView page={page} />;
}
