# Tempo Zones Reference

This document is a working reference for how Tempo Zones are structured onchain, how to discover them, and what to query when new deployments appear.

The main body is intended to stay evergreen. The appendix is a dated testnet snapshot collected from Moderato RPC on 2026-04-16.

## Scope

This page covers:

- the Zone contract model on Tempo L1
- the main types and events that define the interface
- how to enumerate zones from the factory
- how to recognize active portals from RPC calls and logs
- a Moderato testnet appendix with concrete addresses and sample activity

It does not attempt to restate the full protocol spec. For the complete upstream protocol document, see the Zones spec in the upstream repo.

## Contract Model

A Tempo Zone is anchored to Tempo L1 through two per-zone contracts:

- `ZonePortal`: escrows deposited TIP-20 tokens on Tempo, accepts batch submissions, manages enabled tokens and encryption keys, and processes withdrawals
- `ZoneMessenger`: executes withdrawal callbacks on Tempo so the portal can transfer tokens and call a recipient atomically

Zones are created by a shared `ZoneFactory`. The factory assigns the `zoneId`, deploys the messenger and portal, records the deployment in its internal registry, and emits `ZoneCreated`.

The upstream factory deploys the messenger first, predicts the portal address with the normal `CREATE` formula, then deploys the portal using that predicted address as the messenger's immutable portal reference.

## Core Types

### `IZoneFactory.CreateZoneParams`

```solidity
struct CreateZoneParams {
    address initialToken;
    address sequencer;
    address verifier;
    ZoneParams zoneParams;
}
```

### `ZoneInfo`

```solidity
struct ZoneInfo {
    uint32 zoneId;
    address portal;
    address messenger;
    address initialToken;
    address sequencer;
    address verifier;
    bytes32 genesisBlockHash;
    bytes32 genesisTempoBlockHash;
    uint64 genesisTempoBlockNumber;
}
```

This is the canonical registry record returned by `ZoneFactory.zones(zoneId)`.

### `TokenConfig`

```solidity
struct TokenConfig {
    bool enabled;
    bool depositsActive;
}
```

`enabled` is permanent. `depositsActive` can be paused and resumed by the sequencer.

## Factory Contract Details

The shared `ZoneFactory` is the first thing to find on any network. Once you have it, the rest of the discovery process is mechanical.

Useful reads:

- `zoneCount() -> uint32`
- `zones(uint32 zoneId) -> ZoneInfo`
- `isZonePortal(address portal) -> bool`
- `isZoneMessenger(address messenger) -> bool`
- `isValidVerifier(address verifier) -> bool`
- `verifier() -> address`

Important behavior from the upstream implementation:

- `_nextZoneId` starts at `1`
- `_isZonePortal` and `_isZoneMessenger` are set during zone creation
- the factory constructor deploys a default verifier and stores it as valid
- `createZone(...)` reverts unless the initial token is TIP-20, the sequencer is nonzero, the verifier is allowlisted, and enough gas is supplied

## Portal Contract Details

Once you have a portal address, these reads are the fastest way to map its operating surface:

- `zoneId() -> uint32`
- `messenger() -> address`
- `verifier() -> address`
- `sequencer() -> address`
- `zoneGasRate() -> uint128`
- `enabledTokenCount() -> uint256`
- `enabledTokenAt(uint256 index) -> address`
- `encryptionKeyCount() -> uint256`

Useful interpretations:

- `zoneGasRate = 0` means deposits currently charge no portal fee
- `enabledTokenCount > 1` means the sequencer has expanded the asset set beyond the initial token
- `encryptionKeyCount > 0` means encrypted deposits are configured

## Chain ID Pattern

The upstream zone spec describes the chain ID as derived from the zone ID:

```text
chain_id = 421700000 + zone_id
```

The broader CLI docs also describe mainnet and testnet derivations with fixed prefixes. For discovery work, the important point is that the zone ID is the root identifier and the L2 chain ID is deterministically derived from it.

## Event Surface

These are the events that matter most for discovery and monitoring.

### Factory

| Event | Purpose | Topic0 |
|---|---|---|
| `ZoneCreated(uint32,address,address,address,address,address,bytes32,bytes32,uint64)` | New zone deployment | `0xa0d8b561b80ba334b8b367f1fd53ab8d8719fa1c348a8de4bbfd8bbffa90b337` |

Indexed fields:

- `zoneId`
- `portal`
- `messenger`

### Portal

| Event | Purpose | Topic0 |
|---|---|---|
| `DepositMade(bytes32,address,address,address,uint128,uint128,bytes32)` | Cleartext deposit into a zone | `0x75ab26fe3a392fb5f2259a165dc4027a5144ecdd47f538d708c27d7d3623f28c` |
| `EncryptedDepositMade(bytes32,address,address,uint128,uint128,uint256,bytes32,uint8,bytes,bytes12,bytes16)` | Encrypted recipient/memo deposit | `0x98f4c0a35673d35a0ee250067468548aa0f03ffeecceea2bfde70290d0f8094f` |
| `BatchSubmitted(uint64,bytes32,bytes32,bytes32)` | Sequencer submitted a proof-backed batch | `0xf32cf46684a7f53ae480d44fa855c89c402f5ef0838aa63d1d349ee85597c359` |
| `WithdrawalProcessed(address,address,uint128,bool)` | Withdrawal executed on Tempo | `0x49ae2215ae0dc5cb44364a538a7007364db417143d69e45cf5247c53a7940bf2` |
| `SequencerEncryptionKeyUpdated(bytes32,uint8,uint256,uint64)` | Portal encryption key rotation or initial setup | `0x82b5f4090f18a082bc8156b956154bfe0319307f5e5a7e903ef33f14ad2cb17e` |
| `TokenEnabled(address,string,string,string)` | New TIP-20 enabled on the portal | `0x4ac4dcc08b0c26c3fb6b58c64c1392b7934b1ce6b0382a5986ea5c3de795e053` |

## Function Selectors

These are the most useful selectors when scanning raw tx input:

| Function | Selector |
|---|---|
| `createZone((address,address,address,(bytes32,bytes32,uint64)))` | `0x8c642587` |
| `deposit(address,address,uint128,bytes32)` | `0x1e77625f` |
| `depositEncrypted(address,uint128,uint256,(bytes32,uint8,bytes,bytes12,bytes16))` | `0x0cdc05ad` |
| `submitBatch((bytes32,bytes32,uint64),(bytes32,bytes32,bytes32,uint64),(bytes32,bytes32,bytes32,uint64)[],bytes,bytes32[])` | `0xe1df7f4d` |
| `processWithdrawal((address,address,uint128,uint128,address,bytes32,uint128,address,bytes,bytes32),bytes32)` | `0x19432bb9` |
| `setSequencerEncryptionKey(bytes32,uint8,uint8,bytes32,bytes32)` | `0xef10b187` |
| `isZonePortal(address)` | `0x01b290d3` |
| `zoneCount()` | `0xeee83499` |
| `zones(uint32)` | `0x90b7f6fd` |

## Discovery Playbook

### Canonical method

Use the shared factory.

1. Find the network's `ZoneFactory`
2. Call `zoneCount()`
3. Iterate `zones(1..zoneCount)`
4. Validate every returned portal with `isZonePortal(portal)`
5. For each portal, read:
   - `zoneId`
   - `sequencer`
   - `zoneGasRate`
   - `enabledTokenCount` and `enabledTokenAt`
   - `encryptionKeyCount`
6. Backfill activity by scanning portal logs for:
   - `DepositMade`
   - `EncryptedDepositMade`
   - `BatchSubmitted`
   - `WithdrawalProcessed`
   - `TokenEnabled`
   - `SequencerEncryptionKeyUpdated`

This is the strongest detection method because it is registry-backed rather than heuristic.

### Fallback method

If the factory address is not yet published:

1. scan for `ZoneCreated` if you can identify candidate factory contracts
2. scan tx input for `createZone(...)`
3. scan tx input for portal-only selectors like `deposit(...)`, `depositEncrypted(...)`, `submitBatch(...)`, and `processWithdrawal(...)`
4. confirm candidates by calling `zoneId()`, `sequencer()`, and `enabledTokenCount()`

This is weaker than the registry method and should only be used to bootstrap discovery until the official factory is known.

## What Active Portals Look Like

A portal is not just "deployed"; it becomes operational when some combination of the following appears:

- `TokenEnabled` has fired for one or more tokens
- `SequencerEncryptionKeyUpdated` has fired at least once
- `BatchSubmitted` is happening regularly
- `DepositMade` or `EncryptedDepositMade` is present
- `WithdrawalProcessed` is present

Practical signals:

- lots of `BatchSubmitted`, plus deposits and withdrawals, means a live zone
- `TokenEnabled` plus encryption-key setup but no deposits usually means a freshly initialized zone
- no recent events may mean an inactive or abandoned test portal

## RPC Recipe

For any network, the minimal RPC recipe is:

1. `eth_call` to the factory:
   - `zoneCount()`
   - `zones(zoneId)`
   - `isZonePortal(portal)`
2. `eth_call` to the portal:
   - `zoneId()`
   - `sequencer()`
   - `zoneGasRate()`
   - `enabledTokenCount()`
   - `enabledTokenAt(i)`
   - `encryptionKeyCount()`
3. `eth_getLogs` for:
   - `ZoneCreated` on the factory
   - portal events on each enumerated portal

If the RPC has a max block range for logs, chunk the requests.

## Appendix: Moderato Testnet Snapshot

Snapshot date: `2026-04-16`

### Shared Factory

- RPC: `https://rpc.moderato.tempo.xyz`
- latest block during collection: `13,210,792`
- factory: `0x7Cc496Dc634b718289c192b59CF90262C5228545`
- reported `zoneCount()`: `8`

### Enumerated Zones

| Zone | Portal | Messenger | Initial Token | Sequencer | Genesis Tempo Block |
|---|---|---|---|---|---|
| 1 | `0xaf32eae9aD3E1fe9E1439De454ddb260e786a6A8` | `0x8b14c92187140dcD4013D2603DD9830e31758569` | pathUSD | `0x05C265fB662bf03f0f6cb7A572ea4a92fd654a2e` | `10189557` |
| 2 | `0x1aAe46282C4A2338B6730BAC7d51718d1A8A56DE` | `0xAd874E171552301e2492F9132c03b93e5F73726f` | pathUSD | `0x71a27EB1eaD95eC39c3C341ea542a2f1af79cdB3` | `10194463` |
| 3 | `0x69A207Fd930Ca1F850C65E95902b284f50167aB2` | `0x7a1B86d6a1A0Ad7C4b9e1b6B05f74371c7Ac7304` | pathUSD | `0x0399C2d854B5273B5D561C92bb94f9935c9c55D4` | `10470242` |
| 4 | `0x675628a35D23b37E3200b9DfcaD6Bc63AB3834BC` | `0x5bC46D2Ede5EEbD11bab2D003fFE24AaaE0cd27c` | pathUSD | `0x262287AC6F33B87F72F10465309e309CA6C5Ac34` | `10942584` |
| 5 | `0xe52bA46afE7C460eF5E05aBc46e6e462eB714270` | `0x22966a8AA024747d249A05c9c552c946d88fB44f` | pathUSD | `0x581E5B3aBe33A6c41e16d6b661F44A304EEB7e75` | `10942589` |
| 6 | `0x7069DeC4E64Fd07334A0933eDe836C17259c9B23` | `0xdAabc62fd810C45241b399efEB6c98fc35479280` | pathUSD | `0x09300ebA7a83cF2945A90ce3576b6a6586500Ad5` | `10957661` |
| 7 | `0x3F5296303400B56271b476F5A0B9cBF74350D6Ac` | `0x53482A6c8c2cF64d73a5aa7A4f90DC97c697eB30` | pathUSD | `0x7b23cA0Acc937110045E23206006573C65c1caeF` | `10957666` |
| 8 | `0x42ec1D9c9c35232E30180bB991C23FE7dd453d99` | `0xBcA8580E4C5c87e69311DCa06AbC1A9898eBBd74` | pathUSD | `0xE6AE5888BA2Ad654819D8C814280Fb200C7B7002` | `13118076` |

### Portal Configuration Highlights

- all 8 portals validated through `isZonePortal`
- all portals reported `zoneGasRate = 0`
- zone 1 reported `encryptionKeyCount = 0`
- zones 2-8 reported `encryptionKeyCount = 1`

Enabled token highlights:

- zones 1, 3, and 8: only pathUSD `0x20C0000000000000000000000000000000000000`
- zone 2: pathUSD plus `0x20c000000000000000000000DCDC3Ac80b72DA6c`
- zones 4, 5, 6, and 7: four enabled tokens, `0x20C0...0000` through `0x20C0...0003`

### Recent Activity Window

Recent window used for activity scan: last `100,000` blocks ending at `13,210,821`.

| Zone | Deposits | Encrypted Deposits | Batches | Withdrawals | Notes |
|---|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 | no recent activity |
| 2 | 0 | 0 | 0 | 0 | no recent activity |
| 3 | 0 | 0 | 0 | 0 | no recent activity |
| 4 | 0 | 0 | 0 | 0 | no recent activity |
| 5 | 0 | 0 | 0 | 0 | no recent activity |
| 6 | 129 | 2 | 1085 | 102 | clearly active |
| 7 | 55 | 0 | 1059 | 8 | active |
| 8 | 0 | 0 | 4 | 0 | newly initialized |

### Sample Creation Transactions

| Zone | Create Tx |
|---|---|
| 1 | `0x4662dd2243b6cb73d67608cf98ef71c26db2d44cb5c15393dd6adb82456c1d8d` |
| 2 | `0x6c5fea568766193208b4ff2d7a14b930433f50ff5a30734309644220ed55e918` |
| 3 | `0x4879554b6f86a504a58de1a73d35a969c60c609072802193fa59c5bb56a8cb93` |
| 4 | `0xff08675f4d2c985221aa31343a30d0e35994c8b96d43c4173e905f3ebf5f3a9a` |
| 5 | `0x3fd51592ab023839025cdc1d9c0fc3e9c9be8d231ff779e1f5d890fe2b304105` |
| 6 | `0x3b7ab89d1c0deecd8b8aea5cc88833b6ddf4bf414c67b511c217eab5a2c3d38f` |
| 7 | `0x938c2436114889c51281a9204c7e2f4f8dae2bca176c562543aa1039bbc021a3` |
| 8 | `0x67909a36553ff13bb757558c1894b5596a6616ba68a81e7259402096b4c2d422` |

### Sample Live Activity

Zone 6 cleartext deposit:

- tx: `0x504730d309a5e2eab37f02e892fbdf7918b27dc824d5b938bab54067bd843e61`
- sender: `0x35D01486dD24248e9D642B21732799C3cd89e6f8`
- recipient: `0xA374e84B00557f39f89F0DE5ed89180a935B16A7`
- token: pathUSD
- `netAmount = 10000000000`
- `fee = 0`
- memo bytes decode to `payroll-deposit`

Zone 6 encrypted deposit:

- tx: `0xd917c0912b6f33d17fd4a500079d9d4a7dd030933c260e39f4bf74748f17cabf`
- `netAmount = 100000000`
- `keyIndex = 0`

Zone 6 batch submission:

- tx: `0x1f5fd9d122200e46c391f21ad9bcd9052a183907c76fe4b2e58a32674100ef95`
- `withdrawalBatchIndex = 16031`

Zone 6 processed withdrawal:

- tx: `0xbcd675fd791f3ca5add3731c8b6934d732ebb645e1e60b34a0f964769e8ec0c7`
- recipient: `0xA374e84B00557f39f89F0DE5ed89180a935B16A7`
- token: pathUSD
- `amount = 2500000000`
- `callbackSuccess = true`

Zone 8 initialization:

- `TokenEnabled` tx: `0x67909a36553ff13bb757558c1894b5596a6616ba68a81e7259402096b4c2d422`
- token metadata:
  - name: `PathUSD`
  - symbol: `PathUSD`
  - currency: `USD`
- `SequencerEncryptionKeyUpdated` tx: `0x739ab07fc93a4b4f5f58320c404f168dd2ccfc7b4aefa38cb640238d891ab57c`

