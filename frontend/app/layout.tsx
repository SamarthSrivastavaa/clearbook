import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

import { Chrome } from '@/components/Chrome';
import { Providers } from './providers';
import './globals.css';

/**
 * IBM Plex, not the framework default.
 *
 * Plex Sans reads as institutional and slightly editorial rather than as generic
 * product UI, and Plex Mono is a genuinely legible companion for the hashes and
 * amounts that fill this product. The pairing is a deliberate identity choice.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Absolute base for social images. Without it Next resolves them against
  // localhost and the shared card silently breaks in production.
  metadataBase: new URL(
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://clearbook-sable.vercel.app',
  ),
  title: 'Clearbook — evidence-bound covenant compliance',
  description:
    'A bonded private-credit book whose every claim cites a cryptographically verified source-chain transfer, and whose covenant breaches anyone can prove on-chain.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <Chrome>{children}</Chrome>
        </Providers>
      </body>
    </html>
  );
}
