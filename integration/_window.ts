import { config as loadEnv } from 'dotenv';
loadEnv(); loadEnv({ path: 'frontend/.env.local' });
import { JsonRpcProvider, id as kid } from 'ethers';
const RPC='https://rpc.cc3-testnet.creditcoin.network';
const V=process.env.NEXT_PUBLIC_EVIDENCE_VAULT_ADDRESS!.replace(/^['"]|['"]$/g,'');
const B=process.env.NEXT_PUBLIC_CLEARBOOK_ADDRESS!.replace(/^['"]|['"]$/g,'');
const p=new JsonRpcProvider(RPC); const head=await p.getBlockNumber();
const WINDOW=60000, SEC=15;
const factTopic=kid('TransferFactStored(bytes32,uint64,uint64,uint64,uint32,address,address,address,uint256,address)');
const bindTopic=kid('TreasuryBound(uint256,address,uint256,uint64)');
async function scan(addr:string, topic:string){
  const out:number[]=[];
  for(let f=head-WINDOW; f<=head; f+=10000){
    const t=Math.min(f+9999,head);
    try{ for(const l of await p.getLogs({address:addr,topics:[topic],fromBlock:f,toBlock:t})) out.push(l.blockNumber);}catch{}
  }
  return out;
}
const facts=await scan(V,factTopic); const binds=await scan(B,bindTopic);
const oldestFact=Math.min(...facts), oldestBind=binds.length?Math.min(...binds):NaN;
const hrs=(n:number)=>(n*SEC/3600).toFixed(1);
console.log(`CC head            ${head}`);
console.log(`window             ${WINDOW} blocks (~${(WINDOW*SEC/86400).toFixed(1)} days at ${SEC}s)`);
console.log(`facts in window    ${facts.length}`);
console.log(`oldest fact        block ${oldestFact}, age ${head-oldestFact} blocks (${hrs(head-oldestFact)}h)`);
console.log(`  -> drops out in  ${WINDOW-(head-oldestFact)} blocks = ${hrs(WINDOW-(head-oldestFact))}h = ${((WINDOW-(head-oldestFact))*SEC/86400).toFixed(1)} days`);
console.log(`  -> expiry approx ${new Date(Date.now()+(WINDOW-(head-oldestFact))*SEC*1000).toISOString()}`);
if(binds.length){
console.log(`oldest binding     block ${oldestBind}, age ${head-oldestBind} blocks`);
console.log(`  -> drops out in  ${WINDOW-(head-oldestBind)} blocks = ${((WINDOW-(head-oldestBind))*SEC/86400).toFixed(1)} days`);
console.log(`  -> expiry approx ${new Date(Date.now()+(WINDOW-(head-oldestBind))*SEC*1000).toISOString()}`);
}
