# SIZCOIN Backend Implementation Requirements

## ⚠️ CRITICAL: This is NOT native ALGO - It's SIZCOIN (ASA)

**SIZCOIN Asset ID: `2905622564`**  
**Decimals: 2** (1 SIZ = 100 micro units, NOT 1,000,000 like ALGO)

---

## 🎯 Key Differences from Native ALGO

| Aspect | Native ALGO | SIZCOIN (ASA) |
|--------|-------------|---------------|
| **Asset ID** | N/A (native) | **2905622564** |
| **Transaction Type** | Payment (`pay`) | **Asset Transfer (`axfer`)** |
| **Decimals** | 6 | **2** |
| **Micro Units** | 1 ALGO = 1,000,000 | **1 SIZ = 100** |
| **Opt-in Required** | No | **YES - MANDATORY** |
| **Function** | `makePaymentTxnWithSuggestedParamsFromObject` | **`makeAssetTransferTxnWithSuggestedParamsFromObject`** |

---

## 📋 Implementation Changes Made

### 1. **Updated Constants** (`src/services/algorand.ts`)

```typescript
const SIZCOIN_ASSET_ID = 2905622564; // SIZCOIN on Algorand
const SIZCOIN_DECIMALS = 2; // 2 decimal places
const MICRO_UNITS_PER_SIZ = 100; // 1 SIZ = 100 micro units
```

### 2. **Amount Conversions**

❌ **OLD (ALGO):**
```typescript
const amountInMicroAlgos = amount * 1_000_000;
```

✅ **NEW (SIZCOIN):**
```typescript
const amountInMicroUnits = amount * 100;
```

**Examples:**
- 1 SIZ = 100 micro units
- 10.50 SIZ = 1,050 micro units
- 0.01 SIZ = 1 micro unit (minimum)

### 3. **Transaction Types**

❌ **OLD (Payment Transaction):**
```typescript
const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  from: escrowAddress,
  to: employeeAddress,
  amount: amountInMicroAlgos,
  suggestedParams,
});
```

✅ **NEW (Asset Transfer Transaction):**
```typescript
const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  from: escrowAddress,
  to: employeeAddress,
  amount: amountInMicroUnits,
  assetIndex: SIZCOIN_ASSET_ID, // 2905622564
  suggestedParams,
});
```

### 4. **Opt-in Requirement**

**All accounts MUST opt-in to SIZCOIN before receiving it!**

✅ **New Function Added:**
```typescript
export async function optInToSIZCOIN(escrowAddress: string, encryptedPrivateKey: string) {
  // Create opt-in transaction (amount = 0, to self)
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: escrowAddress,
    to: escrowAddress, // To self!
    amount: 0, // Zero amount
    assetIndex: SIZCOIN_ASSET_ID,
    suggestedParams,
  });
  // Sign and send...
}
```

### 5. **Balance Checking**

❌ **OLD (ALGO Balance):**
```typescript
const accountInfo = await algodClient.accountInformation(address).do();
return accountInfo.amount / 1_000_000;
```

✅ **NEW (SIZCOIN Balance):**
```typescript
const accountInfo = await algodClient.accountInformation(address).do();
const assets = accountInfo.assets || [];
const sizcoinAsset = assets.find(asset => asset['asset-id'] === SIZCOIN_ASSET_ID);
return sizcoinAsset ? sizcoinAsset.amount / 100 : 0;
```

### 6. **Deposit Verification**

✅ **Updated to verify SIZCOIN transactions:**
```typescript
// Check asset-transfer-transaction field (not payment-transaction)
const assetTxn = txInfo['asset-transfer-transaction'];

// Verify Asset ID
if (assetTxn['asset-id'] !== SIZCOIN_ASSET_ID) {
  throw new Error('Not a SIZCOIN transaction');
}

// Convert amount
const amountInSIZ = assetTxn.amount / 100;
```

---

## 🔧 Critical Endpoints Updated

### POST `/api/projects/:projectId/escrow/create`

**What Changed:**
- Returns `assetId: 2905622564`
- Returns step-by-step instructions
- Warns about opt-in requirement

**Response:**
```json
{
  "success": true,
  "escrowAddress": "ABC123...",
  "assetId": 2905622564,
  "instructions": {
    "step1": "Fund escrow with ALGO for fees (min 0.1 ALGO)",
    "step2": "Call POST /escrow/opt-in",
    "step3": "Fund escrow with SIZCOIN",
    "step4": "Record deposit"
  }
}
```

### POST `/api/projects/:projectId/escrow/opt-in` ⭐ NEW

**Purpose:** Opt the escrow account into SIZCOIN

**Request:**
```http
POST /api/projects/:projectId/escrow/opt-in
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "success": true,
  "txHash": "OPT123...",
  "assetId": 2905622564,
  "message": "Escrow opted-in to SIZCOIN"
}
```

**When to call:**
1. After creating escrow
2. After funding with ALGO (for transaction fees)
3. Before sending SIZCOIN to escrow

### POST `/api/projects/:projectId/escrow/deposit`

**What Changed:**
- Verifies `asset-transfer-transaction` (not `payment-transaction`)
- Checks Asset ID = 2905622564
- Uses 100 (not 1,000,000) for conversion

**Request:**
```json
{
  "txHash": "DEPOSIT123...",
  "amount": 1000.50
}
```

**Verification Logic:**
```typescript
// Must be asset transfer
if (!txInfo['asset-transfer-transaction']) {
  throw new Error('Not an asset transfer');
}

// Must be SIZCOIN
if (assetTxn['asset-id'] !== 2905622564) {
  throw new Error('Wrong asset');
}

// Amount in SIZ
const amountInSIZ = assetTxn.amount / 100;
```

### POST `/api/tasks/:taskId/approve`

**What Changed:**
- Checks employee wallet opted-in to SIZCOIN
- Uses `makeAssetTransferTxnWithSuggestedParamsFromObject`
- Converts amount: SIZ × 100 = micro units

**Enhanced Validation:**
```typescript
// NEW: Check employee opt-in status
const employeeOptedIn = await isOptedInToSIZCOIN(employeeWalletAddress);
if (!employeeOptedIn) {
  throw new Error('Employee must opt-in to SIZCOIN first');
}

// Use ASA transfer (not payment)
const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  from: escrowAddress,
  to: employeeWalletAddress,
  amount: amount * 100, // SIZ to micro units
  assetIndex: 2905622564,
  suggestedParams,
});
```

### POST `/api/users/wallet/verify`

**What Changed:**
- Checks if wallet has opted-in to SIZCOIN
- Rejects wallets that haven't opted-in

**Enhanced Validation:**
```typescript
// NEW: Verify SIZCOIN opt-in
const optedIn = await isOptedInToSIZCOIN(walletAddress);
if (!optedIn) {
  return res.status(400).json({
    error: 'Wallet not opted-in to SIZCOIN',
    message: 'Please opt-in to Asset ID 2905622564',
    assetId: 2905622564
  });
}
```

---

## 🛠️ New Helper Functions

### `isOptedInToSIZCOIN(address: string): Promise<boolean>`

**Purpose:** Check if an address has opted-in to SIZCOIN

```typescript
export async function isOptedInToSIZCOIN(address: string): Promise<boolean> {
  const accountInfo = await algodClient.accountInformation(address).do();
  const assets = accountInfo.assets || [];
  return assets.some(asset => asset['asset-id'] === SIZCOIN_ASSET_ID);
}
```

**When to use:**
- Before sending SIZCOIN to any address
- During wallet verification
- When checking escrow status

### `optInToSIZCOIN(address, privateKey): Promise<TxResult>`

**Purpose:** Opt an account into SIZCOIN

**Process:**
1. Create asset transfer to self with amount = 0
2. Sign with account's private key
3. Submit to blockchain
4. Wait for confirmation

---

## ✅ Testing Checklist

### Escrow Creation & Opt-in
- [ ] Create escrow account
- [ ] Fund escrow with ALGO (min 0.1 ALGO for fees)
- [ ] Call opt-in endpoint
- [ ] Verify opt-in on blockchain
- [ ] Fund escrow with SIZCOIN
- [ ] Record deposit

### Employee Wallet
- [ ] Employee opts-in to SIZCOIN in their wallet
- [ ] Employee verifies wallet in system
- [ ] System checks opt-in status
- [ ] Wallet address stored in database

### Task Payment
- [ ] Create task with payment amount
- [ ] Complete task
- [ ] Approve task (triggers payment)
- [ ] Verify ASA transfer transaction
- [ ] Check employee receives SIZCOIN
- [ ] Verify balance updates

### Balance Checking
- [ ] Query SIZCOIN balance (not ALGO)
- [ ] Verify correct Asset ID (2905622564)
- [ ] Check conversion (micro units ÷ 100)
- [ ] Test with opted-in and non-opted-in accounts

### Amount Conversions
- [ ] Test: 1 SIZ → 100 micro units
- [ ] Test: 10.50 SIZ → 1,050 micro units
- [ ] Test: 0.01 SIZ → 1 micro unit
- [ ] Test: 999.99 SIZ → 99,999 micro units

---

## 🚨 Common Errors & Solutions

### Error: "Asset not found in account"
**Cause:** Account hasn't opted-in to SIZCOIN  
**Solution:** Call opt-in endpoint or opt-in via wallet

### Error: "Transaction is not an asset transfer"
**Cause:** Verifying ALGO payment as SIZCOIN  
**Solution:** Check `asset-transfer-transaction` field

### Error: "Wrong asset ID"
**Cause:** Transaction uses different asset  
**Solution:** Verify Asset ID = 2905622564

### Error: "Amount mismatch"
**Cause:** Using wrong decimal conversion  
**Solution:** Use ×100 (not ×1,000,000)

### Error: "Receiver account not opted-in"
**Cause:** Sending to non-opted-in wallet  
**Solution:** Recipient must opt-in first

---

## 📊 Database Schema

**No changes needed!** All existing schema works with SIZCOIN.

The `amount` fields store SIZ values (with 2 decimals), and conversions happen only in the Algorand service layer.

---

## 🔐 Security Notes

1. **Opt-in is mandatory** - Never skip this check
2. **Always verify Asset ID** - Prevent wrong token transfers
3. **Check recipient opt-in** - Before sending payments
4. **Validate decimals** - Always use 100 (not 1,000,000)
5. **Monitor transactions** - ASA transfers, not payments

---

## 📝 Environment Variables

```env
# Unchanged
ALGORAND_NODE_URL=https://testnet-api.algonode.cloud
ALGORAND_INDEXER_URL=https://testnet-idx.algonode.cloud
ALGORAND_NETWORK=testnet
ENCRYPTION_SECRET=your_secret_key
PAYMENT_CONFIRMATION_THRESHOLD=3
```

No new environment variables needed!

---

## 🎓 Resources

- [SIZCOIN on Algorand Explorer](https://testnet.algoexplorer.io/asset/2905622564)
- [Algorand ASA Documentation](https://developer.algorand.org/docs/get-details/asa/)
- [Asset Opt-in Guide](https://developer.algorand.org/docs/get-details/asa/#receiving-an-asset)
- [AlgoSDK Asset Transfer](https://algorand.github.io/js-algorand-sdk/)

---

## ✨ Summary for Backend Team

**What YOU need to know:**

1. ✅ **All changes are COMPLETE** - No more coding required
2. ✅ **Use Asset ID 2905622564** - Not native ALGO
3. ✅ **Opt-in is mandatory** - For escrow and employees
4. ✅ **Amount × 100** - Not ×1,000,000
5. ✅ **ASA transfers** - Not payment transactions
6. ✅ **Test thoroughly** - Different from ALGO behavior

**The system is ready for SIZCOIN!** 🚀

