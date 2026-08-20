/**
 * GET /health (BUILD.md §8.3): worker state, latest attested height per chain,
 * and cursor lag. Node's built-in http server — no framework, no dependency.
 */
import { createServer, type Server } from 'node:http';

import { log, metrics } from './log.js';

export interface HealthState {
  status: 'starting' | 'ok' | 'degraded';
  startedAt: string;
  lastScanAt?: string;
  lastError?: string;
  chains: Record<
    number,
    {
      chainId?: number;
      attestedHeight?: number;
      sourceHead?: number;
      cursor?: number | null;
      /** attestedHeight - cursor: how far behind the scanner is. */
      cursorLag?: number | null;
    }
  >;
  dbConnected: boolean;
  factsByState: Record<string, number>;
}

export class HealthServer {
  private server?: Server;
  private state: HealthState;

  constructor(private readonly port: number) {
    this.state = {
      status: 'starting',
      startedAt: new Date().toISOString(),
      chains: {},
      dbConnected: false,
      factsByState: {},
    };
  }

  update(patch: Partial<HealthState>): void {
    this.state = { ...this.state, ...patch, chains: { ...this.state.chains, ...(patch.chains ?? {}) } };
  }

  updateChain(chainKey: number, patch: HealthState['chains'][number]): void {
    this.state.chains[chainKey] = { ...(this.state.chains[chainKey] ?? {}), ...patch };
  }

  snapshot(): HealthState & { metrics: Record<string, unknown> } {
    return { ...this.state, metrics: metrics.snapshot() };
  }

  start(): void {
    this.server = createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        const body = JSON.stringify(this.snapshot(), null, 2);
        // Degraded is still a 200: the endpoint reports state, it is not an alarm.
        res.writeHead(this.state.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    this.server.listen(this.port, () => log.info('health endpoint listening', { port: this.port }));
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
