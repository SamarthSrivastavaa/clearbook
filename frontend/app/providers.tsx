'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { creditcoin } from '@/lib/config';

/**
 * Only an injected connector. WalletConnect would add a large dependency and a
 * relay hop for no benefit: the demo runs on a desktop browser with a wallet
 * extension, and fewer moving parts is worth more than more wallet options.
 */
export const wagmiConfig = createConfig({
  chains: [creditcoin],
  connectors: [injected()],
  transports: {
    [creditcoin.id]: http(creditcoin.rpcUrls.default.http[0]),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chain reads are cheap but not free, and a live demo should not
            // thrash the RPC. Contract state changes on block cadence, so a
            // short stale window is both correct and calm.
            staleTime: 8_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
