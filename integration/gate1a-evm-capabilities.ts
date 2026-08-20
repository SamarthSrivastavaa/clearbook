/**
 * Determines which EVM version CC3 testnet actually supports, so that
 * foundry.toml's `evm_version` is set from evidence rather than assumption.
 *
 * BUILD.md Phase 1 says "set solc = 0.8.28 and evm_version in foundry.toml" but
 * does not say which version. Solidity 0.8.28 defaults to `cancun`; if the chain
 * rejects cancun opcodes, contracts compile locally and fail on deployment.
 *
 * Method: `eth_call` with no `to` address executes the supplied bytes as contract
 * creation code. Costs nothing, needs no funded account. If an opcode is not
 * supported the node reports an invalid-opcode/revert error instead of returning.
 *
 * Each probe pushes the operands the opcode needs, executes it, then STOPs.
 */
import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';

interface Probe {
  name: string;
  /** EVM upgrade that introduced the opcode */
  introducedIn: string;
  opcode: string;
  /** creation code: operands, opcode, STOP */
  code: string;
}

const PROBES: Probe[] = [
  // PUSH0 (0x5f) — Shanghai. No operands.
  { name: 'PUSH0', introducedIn: 'shanghai', opcode: '5f', code: '0x5f00' },
  // MCOPY (0x5e) — Cancun. Pops destOffset, offset, length.
  { name: 'MCOPY', introducedIn: 'cancun', opcode: '5e', code: '0x6000600060005e00' },
  // TSTORE (0x5d) — Cancun. Pops key, value.
  { name: 'TSTORE', introducedIn: 'cancun', opcode: '5d', code: '0x600060005d00' },
  // TLOAD (0x5c) — Cancun. Pops key.
  { name: 'TLOAD', introducedIn: 'cancun', opcode: '5c', code: '0x60005c00' },
];

async function probe(rpc: JsonRpcProvider, p: Probe): Promise<{ supported: boolean; detail: string }> {
  try {
    // No `to` field => the node executes `code` as creation bytecode.
    await rpc.call({ data: p.code });
    return { supported: true, detail: 'executed without error' };
  } catch (e: any) {
    const msg = String(e?.shortMessage ?? e?.info?.error?.message ?? e?.message ?? e);
    return { supported: false, detail: msg };
  }
}

async function main(): Promise<void> {
  const url = process.env.CREDITCOIN_RPC_URL;
  if (!url) throw new Error('CREDITCOIN_RPC_URL is not set');

  const rpc = new JsonRpcProvider(url);
  const net = await rpc.getNetwork();
  console.log(`Creditcoin RPC: ${url}`);
  console.log(`chainId: ${net.chainId}\n`);

  // Sanity check: a trivially valid probe must succeed, otherwise a failure
  // below would mean "eth_call rejects creation-code calls", not "opcode missing".
  const control = await probe(rpc, { name: 'STOP (control)', introducedIn: 'frontier', opcode: '00', code: '0x00' });
  console.log(`control STOP: ${control.supported ? 'OK' : 'FAILED'} ${control.supported ? '' : '- ' + control.detail}`);
  if (!control.supported) {
    console.error('\nControl probe failed: this node does not support eth_call with creation code.');
    console.error('The opcode results below would be meaningless. Aborting.');
    process.exitCode = 1;
    return;
  }
  console.log('');

  const results: Record<string, boolean> = {};
  for (const p of PROBES) {
    const r = await probe(rpc, p);
    results[p.name] = r.supported;
    console.log(`${p.name.padEnd(7)} (0x${p.opcode}, ${p.introducedIn.padEnd(9)}): ${r.supported ? 'SUPPORTED' : 'NOT SUPPORTED'}`);
    if (!r.supported) console.log(`         ${r.detail}`);
  }

  const cancunOps = PROBES.filter((p) => p.introducedIn === 'cancun');
  const cancun = cancunOps.every((p) => results[p.name]);
  const shanghai = results['PUSH0'];

  let recommended: string;
  if (cancun) recommended = 'cancun';
  else if (shanghai) recommended = 'shanghai';
  else recommended = 'paris';

  console.log(`\nshanghai (PUSH0):            ${shanghai ? 'yes' : 'no'}`);
  console.log(`cancun (MCOPY/TSTORE/TLOAD): ${cancun ? 'yes' : 'no'}`);
  console.log(`\n=> set evm_version = "${recommended}" in contracts/foundry.toml`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
