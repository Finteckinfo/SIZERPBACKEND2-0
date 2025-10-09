import algosdk from 'algosdk';
import crypto from 'crypto';
import { prisma } from '../utils/database.js';

// Algorand Client Configuration
const algodToken = process.env.ALGORAND_NODE_TOKEN || '';
const algodServer = process.env.ALGORAND_NODE_URL || 'https://testnet-api.algonode.cloud';
const algodPort = '';

const indexerServer = process.env.ALGORAND_INDEXER_URL || 'https://testnet-idx.algonode.cloud';
const indexerPort = '';
const indexerToken = '';

// Initialize Algorand clients
export const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
export const indexerClient = new algosdk.Indexer(indexerToken, indexerServer, indexerPort);

// Encryption utilities
const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET || 'default-key-change-in-production';
const ALGORITHM = 'aes-256-cbc';

/**
 * Encrypts a private key for secure storage
 */
export function encryptPrivateKey(privateKey: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts a private key for transaction signing
 */
export function decryptPrivateKey(encryptedPrivateKey: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const parts = encryptedPrivateKey.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Creates a new Algorand escrow account for a project
 */
export async function createEscrowAccount(projectId: string) {
  try {
    // Generate new Algorand keypair
    const account = algosdk.generateAccount();
    const publicAddress = account.addr;
    const privateKey = algosdk.secretKeyToMnemonic(account.sk);
    
    // Encrypt the private key
    const encryptedPrivateKey = encryptPrivateKey(privateKey);
    
    // Store in database
    const escrow = await prisma.projectEscrow.create({
      data: {
        projectId,
        escrowAddress: publicAddress,
        encryptedPrivateKey,
        initialDeposit: 0,
        currentBalance: 0,
        status: 'ACTIVE',
      },
    });
    
    // Update project with escrow address
    await prisma.project.update({
      where: { id: projectId },
      data: { escrowAddress: publicAddress },
    });
    
    return {
      escrowAddress: publicAddress,
      escrow,
    };
  } catch (error) {
    console.error('Error creating escrow account:', error);
    throw new Error('Failed to create escrow account');
  }
}

/**
 * Gets the current balance of an escrow account from the blockchain
 */
export async function getEscrowBalance(escrowAddress: string): Promise<number> {
  try {
    const accountInfo = await algodClient.accountInformation(escrowAddress).do();
    // Convert microAlgos to Algos (or SIZCOIN in your case)
    return accountInfo.amount / 1_000_000;
  } catch (error) {
    console.error('Error fetching escrow balance:', error);
    return 0;
  }
}

/**
 * Verifies a deposit transaction on the blockchain
 */
export async function verifyDepositTransaction(txHash: string, expectedAmount: number, escrowAddress: string) {
  try {
    const txInfo = await algodClient.pendingTransactionInformation(txHash).do();
    
    // Verify transaction details
    if (txInfo['payment-transaction']?.receiver !== escrowAddress) {
      throw new Error('Transaction receiver does not match escrow address');
    }
    
    const amountInAlgos = txInfo['payment-transaction']?.amount / 1_000_000;
    if (Math.abs(amountInAlgos - expectedAmount) > 0.01) {
      throw new Error('Transaction amount does not match expected amount');
    }
    
    return {
      confirmed: txInfo['confirmed-round'] !== undefined,
      amount: amountInAlgos,
      fee: txInfo.txn.txn.fee / 1_000_000,
      blockNumber: txInfo['confirmed-round'],
    };
  } catch (error) {
    console.error('Error verifying deposit transaction:', error);
    throw error;
  }
}

/**
 * Creates and signs a payment transaction from escrow to employee
 */
export async function createPaymentTransaction(
  escrowAddress: string,
  encryptedPrivateKey: string,
  toAddress: string,
  amount: number,
  note?: string
) {
  try {
    // Decrypt the private key
    const mnemonic = decryptPrivateKey(encryptedPrivateKey);
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    
    // Get suggested params from the network
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Convert amount to microAlgos
    const amountInMicroAlgos = Math.floor(amount * 1_000_000);
    
    // Create payment transaction
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: escrowAddress,
      to: toAddress,
      amount: amountInMicroAlgos,
      note: note ? new TextEncoder().encode(note) : undefined,
      suggestedParams,
    });
    
    // Sign the transaction
    const signedTxn = txn.signTxn(account.sk);
    
    // Send the transaction
    const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
    
    return {
      txHash: txId,
      amount,
      fee: suggestedParams.fee / 1_000_000,
    };
  } catch (error) {
    console.error('Error creating payment transaction:', error);
    throw new Error('Failed to create payment transaction');
  }
}

/**
 * Waits for a transaction to be confirmed on the blockchain
 */
export async function waitForConfirmation(txId: string, maxRounds = 4) {
  try {
    const status = await algosdk.waitForConfirmation(algodClient, txId, maxRounds);
    return {
      confirmed: true,
      blockNumber: status['confirmed-round'],
      txId: status.txn.txn.txID,
    };
  } catch (error) {
    console.error('Error waiting for confirmation:', error);
    throw new Error('Transaction confirmation timeout');
  }
}

/**
 * Gets transaction status and confirmation count
 */
export async function getTransactionStatus(txHash: string) {
  try {
    // Try to get transaction info from pending transactions
    try {
      const pendingInfo = await algodClient.pendingTransactionInformation(txHash).do();
      if (pendingInfo['confirmed-round']) {
        const currentRound = (await algodClient.status().do())['last-round'];
        const confirmations = currentRound - pendingInfo['confirmed-round'];
        
        return {
          status: 'CONFIRMED',
          confirmed: true,
          blockNumber: BigInt(pendingInfo['confirmed-round']),
          confirmations,
        };
      }
      return {
        status: 'PENDING',
        confirmed: false,
        blockNumber: null,
        confirmations: 0,
      };
    } catch {
      // If not in pending, search indexer
      const txInfo = await indexerClient.searchForTransactions().txid(txHash).do();
      if (txInfo.transactions && txInfo.transactions.length > 0) {
        const tx = txInfo.transactions[0];
        const currentRound = (await algodClient.status().do())['last-round'];
        const confirmations = currentRound - tx['confirmed-round'];
        
        return {
          status: 'CONFIRMED',
          confirmed: true,
          blockNumber: BigInt(tx['confirmed-round']),
          confirmations,
        };
      }
    }
    
    return {
      status: 'FAILED',
      confirmed: false,
      blockNumber: null,
      confirmations: 0,
    };
  } catch (error) {
    console.error('Error getting transaction status:', error);
    throw new Error('Failed to get transaction status');
  }
}

/**
 * Gets all transactions for an address
 */
export async function getAddressTransactions(address: string, limit = 100) {
  try {
    const response = await indexerClient
      .searchForTransactions()
      .address(address)
      .limit(limit)
      .do();
    
    return response.transactions.map((tx: any) => ({
      txHash: tx.id,
      type: tx['tx-type'],
      amount: tx['payment-transaction']?.amount / 1_000_000 || 0,
      fee: tx.fee / 1_000_000,
      fromAddress: tx.sender,
      toAddress: tx['payment-transaction']?.receiver || '',
      blockNumber: tx['confirmed-round'],
      timestamp: tx['round-time'],
      note: tx.note ? new TextDecoder().decode(Buffer.from(tx.note, 'base64')) : '',
    }));
  } catch (error) {
    console.error('Error fetching address transactions:', error);
    return [];
  }
}

/**
 * Validates an Algorand address
 */
export function isValidAlgorandAddress(address: string): boolean {
  try {
    return algosdk.isValidAddress(address);
  } catch {
    return false;
  }
}

/**
 * Gets account information from blockchain
 */
export async function getAccountInfo(address: string) {
  try {
    const accountInfo = await algodClient.accountInformation(address).do();
    return {
      address: accountInfo.address,
      balance: accountInfo.amount / 1_000_000,
      minBalance: accountInfo['min-balance'] / 1_000_000,
      round: accountInfo.round,
      status: accountInfo.status,
    };
  } catch (error) {
    console.error('Error fetching account info:', error);
    throw new Error('Failed to fetch account information');
  }
}

