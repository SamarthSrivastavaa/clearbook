import type { DocPage } from '../types';

/**
 * Concepts and reference tables.
 *
 * Every address, hash and constant here was read from the repository or from a
 * recorded run artifact. Nothing on this page is illustrative.
 */

const concepts: DocPage = {
  slug: 'concepts',
  title: 'Concepts',
  summary: 'Every term, defined once in plain language and once precisely.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'One plain sentence, then the technical definition. If the two ever disagree, the technical one is correct and the plain one is a bug.',
    },
    {
      t: 'defs',
      items: [
        {
          term: 'TransferFact',
          simple: 'A transfer that Clearbook has verified actually happened.',
          technical: 'An immutable record of `(chainKey, blockHeight, txIndex, logIndex, token, from, to, amount, submitter)`, stored only after the Block Prover precompile verified the transaction’s inclusion and the receipt decoded to a successful ERC-20 `Transfer`.',
        },
        {
          term: 'Evidence consumption',
          simple: 'A fact being used by a claim, after which no other claim can use it.',
          technical: '`factConsumedBy[factId]` is set to the loan id on commitment. It is a single global mapping, so the guarantee holds across all originators.',
        },
        {
          term: 'Claim',
          simple: 'An originator’s statement about a loan, backed by cited evidence.',
          technical: 'A `Loan` record carrying originator, token, borrower, principal, maturity, disbursement fact, optional repayment fact, and status.',
        },
        {
          term: 'Originator',
          simple: 'An institution that publishes claims and posts a bond against them.',
          technical: 'A registered party with a bond, an exposure figure, a published covenant, and immutable circular and challenge windows.',
        },
        {
          term: 'Treasury binding',
          simple: 'Proving you control an address before you can cite money leaving it.',
          technical: 'An EIP-712 signature over `TreasuryBinding(uint256 originatorId, address ethAddress, uint256 nonce, uint256 chainId)`. One address binds to at most one originator, ever. It proves control of a key and nothing more.',
        },
        {
          term: 'Covenant',
          simple: 'A rule the originator published in advance and cannot change.',
          technical: 'Opted into at registration and immutable thereafter. `CIRCULAR_REPAYMENT` is `0x01`, the one implemented today.',
        },
        {
          term: 'Challenge',
          simple: 'Anyone trying to prove a claim broke its covenant.',
          technical: 'A permissionless call citing a funding fact. The contract re-evaluates eleven conditions on-chain and either enforces or reverts with a named error.',
        },
        {
          term: 'Bond, bounty, burn sink',
          simple: 'What the originator stakes, what a successful challenger earns, and where the rest goes.',
          technical: 'Bond is 1 tCTC per open claim. A proven breach slashes 100%, pays 50% to the challenger, and sends the remainder to the protocol sink — the burn address.',
        },
        {
          term: 'Attestation',
          simple: 'The attestor set agreeing that a finalized source block happened.',
          technical: 'Quorum over a finalized block, after which a proof of inclusion can be built against it.',
        },
        {
          term: 'Proof',
          simple: 'The material that lets a contract check a transfer without trusting anyone.',
          technical: 'A Merkle inclusion proof plus continuity roots. Supplied by the proof builder, which is untrusted — the precompile is what makes it meaningful.',
        },
        {
          term: 'Block Prover precompile',
          simple: 'The thing on Creditcoin that rules on whether a proof is real.',
          technical: 'A runtime precompile at `0x…0FD2`. It proves inclusion, not success — receipt status is checked separately by `EvidenceVault`.',
        },
      ],
    },
    { t: 'next', items: [{ href: '/docs/reference', label: 'Reference', sub: 'Addresses, errors, events' }] },
  ],
};

const reference: DocPage = {
  slug: 'reference',
  title: 'Reference',
  summary: 'Addresses, networks, errors, events, and configuration.',
  audience: 'Developers',
  blocks: [
    { t: 'lead', text: 'Read from the repository and from deployment. Testnet unless stated.' },
    { t: 'h', text: 'Deployed contracts' },
    {
      t: 'table',
      head: ['Contract', 'Address', 'Network'],
      rows: [
        ['`EvidenceVault`', '`0x5b6048C74165237fF4A8A3cfe1d38E6fE7b547Af`', 'Creditcoin CC3 testnet'],
        ['`Clearbook`', '`0xCA02D51722947d7a93EDBe398498667bab368315`', 'Creditcoin CC3 testnet'],
        ['Protocol sink', '`0x000000000000000000000000000000000000dEaD`', 'Burn address'],
        ['Block Prover precompile', '`0x0000000000000000000000000000000000000FD2`', 'Creditcoin runtime'],
        ['ChainInfo precompile', '`0x0000000000000000000000000000000000000fd3`', 'Creditcoin runtime'],
      ],
    },
    { t: 'h', text: 'Networks' },
    {
      t: 'table',
      head: ['Network', 'Chain ID', 'Notes'],
      rows: [
        ['Creditcoin CC3 testnet', '102031', 'Where the protocol is deployed'],
        ['Ethereum Mainnet', '1', 'Source chain, chain key 3'],
        ['Ethereum Sepolia', '11155111', 'Source chain, chain key 1'],
      ],
    },
    { t: 'h', text: 'Protocol parameters' },
    {
      t: 'table',
      head: ['Constant', 'Value'],
      rows: [
        ['`MIN_BOND`', '1 ether'],
        ['`BOND_PER_LOAN`', '1 ether'],
        ['`SLASH_BPS`', '10,000 — 100%'],
        ['`BOUNTY_BPS`', '5,000 — 50% to the challenger'],
        ['`REPAYMENT_BPS`', '10,000'],
        ['`WITHDRAW_COOLDOWN`', '1,200 blocks'],
        ['`MIN_CIRCULAR_WINDOW` / `MAX_CIRCULAR_WINDOW`', '1 / 50,000 source blocks'],
        ['`MIN_CHALLENGE_WINDOW`', '1,200 blocks'],
      ],
    },
    { t: 'h', text: 'Covenant condition errors' },
    {
      t: 'table',
      head: ['#', 'Condition', 'Error'],
      rows: [
        ['1', 'The loan has a claimed repayment', '`WrongStatus`'],
        ['2', 'The challenge window is still open', '`WindowClosed`'],
        ['3', 'Both transfers are on the same source chain', '`ChainMismatch`'],
        ['4', 'Both transfers are of the same token', '`TokenMismatch`'],
        ['5', 'The address the treasury funded is the address that repaid', '`NotTheSamePayer`'],
        ['6', 'The funding came from a treasury this originator bound', '`FundingNotFromBoundTreasury`'],
        ['7', 'The payer received at least what it repaid', '`FundingBelowRepayment`'],
        ['8', 'The funding did not come after the repayment', '`FundingNotBefore`'],
        ['9', 'The two transfers fall inside the published window', '`OutsideWindow`'],
        ['10', 'The funding leg is not the repayment itself', '`SameFact`'],
        ['11', 'The funding leg is not the loan’s own disbursement', '`DisbursementNotFunding`'],
      ],
    },
    { t: 'h', text: 'Vault errors' },
    {
      t: 'table',
      head: ['Error', 'Cause'],
      rows: [
        ['`ProofRejected`', 'The precompile refused the bundle'],
        ['`SourceTxReverted`', 'The source receipt did not report success'],
        ['`NotATransferLog`', 'The cited log is not an ERC-20 `Transfer`'],
        ['`MalformedTransferLog`', 'The log did not decode to the expected shape'],
        ['`LogIndexOutOfRange`', 'No log at that transaction-local index'],
        ['`UnsupportedTxType`', 'The transaction envelope type is not handled'],
        ['`UnknownFact`', 'No fact stored at that identifier'],
      ],
    },
    { t: 'h', text: 'Events' },
    {
      t: 'table',
      head: ['Contract', 'Events'],
      rows: [
        ['`EvidenceVault`', '`TransferFactStored`'],
        [
          '`Clearbook`',
          '`OriginatorRegistered`, `TreasuryBound`, `BondIncreased`, `BondWithdrawn`, `LoanRegistered`, `RepaymentClaimed`, `LoanDelinquent`, `CovenantBreached`, `BountyPaid`, `LoanSettled`',
        ],
      ],
    },
    { t: 'h', text: 'Claim and worker states' },
    {
      t: 'table',
      head: ['Domain', 'States'],
      rows: [
        ['Claim', '`NONE`, `REGISTERED`, `REPAYMENT_CLAIMED`, `DELINQUENT`, `SETTLED`, `BREACHED`'],
        [
          'Worker',
          '`DISCOVERED`, `WAITING_ATTESTATION`, `PROVED`, `SUBMITTED`, `CONFIRMED`, with `PRECHECK_FAILED` and `FAILED` as terminal side-exits',
        ],
      ],
    },
    { t: 'h', text: 'Measured figures' },
    {
      t: 'table',
      head: ['Metric', 'Measured'],
      rows: [
        ['Broadcast to usable evidence', '~8–10 minutes'],
        ['`verify()` at the precompile', '0.8 s'],
        ['`submitTransferFact`', '~226,000 gas'],
        ['Deploying both contracts', '0.0018 tCTC'],
        ['Test suite', '94 tests, 100% line coverage of `src/`; branch coverage 75.61%'],
      ],
    },
  ],
};

export const referencePages: DocPage[] = [concepts, reference];
