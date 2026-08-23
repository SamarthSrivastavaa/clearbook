import 'dotenv/config';
import { createPublicClient, http } from 'viem';

/**
 * Is the demo actually presentable right now?
 *
 * The challenge console is the centrepiece, and a claim is only challengeable
 * while its window is open — 1200 blocks at ~15s, so five hours from the moment
 * a repayment is claimed. That window expires silently: nothing breaks, the
 * console simply has nothing to offer.
 *
 * So this asks the chain directly, and says plainly whether to reseed.
 *
 *   npm run demo:status
 */

const strip = (v?: string) => (v ?? '').replace(/^['"]|['"]$/g, '');
const RPC = strip(process.env.CREDITCOIN_RPC_URL);
const CLEARBOOK = strip(process.env.CLEARBOOK_ADDRESS) as `0x${string}`;

const abi = [
  { type: 'function', name: 'nextLoanId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nextOriginatorId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'loans', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' },
    { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint8' }] },
  { type: 'function', name: 'originators', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { type: 'address' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint256' },
    { type: 'uint32' }, { type: 'uint32' }, { type: 'uint64' }, { type: 'uint16' }, { type: 'bool' }] },
] as const;

const STATUS = ['NONE', 'REGISTERED', 'REPAYMENT_CLAIMED', 'FINALIZED', 'DELINQUENT', 'BREACHED'];
const CLAIMED = 2;
const BREACHED = 5;

async function main() {
  if (!RPC || !CLEARBOOK) throw new Error('CREDITCOIN_RPC_URL and CLEARBOOK_ADDRESS must be set');
  const client = createPublicClient({ transport: http(RPC) });

  const head = await client.getBlockNumber();
  const [a, b] = await Promise.all([
    client.getBlock({ blockNumber: head - 200n }),
    client.getBlock({ blockNumber: head }),
  ]);
  const blockSeconds = Number(b.timestamp - a.timestamp) / 200;

  const nextLoan = (await client.readContract({ address: CLEARBOOK, abi, functionName: 'nextLoanId' })) as bigint;
  const nextOrig = (await client.readContract({ address: CLEARBOOK, abi, functionName: 'nextOriginatorId' })) as bigint;

  console.log(`Creditcoin head ${head}  (~${blockSeconds.toFixed(1)}s per block)\n`);

  const windowOf = new Map<bigint, bigint>();
  console.log('Originators');
  for (let id = 1n; id < nextOrig; id++) {
    const o = (await client.readContract({ address: CLEARBOOK, abi, functionName: 'originators', args: [id] })) as readonly unknown[];
    windowOf.set(id, BigInt(o[5] as number));
    const bond = Number(o[2] as bigint) / 1e18;
    const exposure = Number(o[3] as bigint) / 1e18;
    console.log(`  ${id}  ${String(o[1]).padEnd(28)} bond ${bond} tCTC · exposure ${exposure} tCTC · circular ${o[4]} · challenge ${o[5]} · ${o[8] ? 'active' : 'INACTIVE'}`);
  }

  console.log('\nClaims');
  let open = 0;
  let breached = 0;
  for (let id = 1n; id < nextLoan; id++) {
    const l = (await client.readContract({ address: CLEARBOOK, abi, functionName: 'loans', args: [id] })) as readonly unknown[];
    const status = Number(l[8]);
    if (status === BREACHED) breached++;

    let note = '';
    if (status === CLAIMED) {
      const deadline = BigInt(l[7] as bigint) + (windowOf.get(l[0] as bigint) ?? 0n);
      if (deadline > head) {
        open++;
        const mins = (Number(deadline - head) * blockSeconds) / 60;
        note = `CHALLENGEABLE — ${deadline - head} blocks left (~${(mins / 60).toFixed(1)}h)`;
      } else {
        note = `window closed ${head - deadline} blocks ago`;
      }
    }
    console.log(`  loan ${id}  originator ${l[0]}  ${STATUS[status].padEnd(18)} ${note}`);
  }

  console.log('');
  if (open > 0) {
    console.log(`READY — ${open} claim(s) challengeable. The console has something to do.`);
  } else {
    console.log('NOT PRESENTABLE — no open challenge window.');
    console.log('The console degrades honestly (it cites the executed breach), but nothing is live.');
    console.log('Run `npm run demo:seed` to stage a fresh circular flow. Budget ~15 minutes for');
    console.log('source-chain attestation, then the window stays open ~5 hours.');
  }
  if (breached > 0) console.log(`${breached} settled breach(es) remain on the book as standing evidence.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
