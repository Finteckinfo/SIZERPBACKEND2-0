import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

export class ApprovalService {
    private provider: ethers.JsonRpcProvider;
    private multiSigAddress: string;
    private multiSigAbi: string[];

    constructor() {
        const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        this.multiSigAddress = process.env.MULTISIG_WALLET_ADDRESS || '';
        this.multiSigAbi = [
            "function submitTransaction(address to, uint256 value, bytes data)",
            "function confirmTransaction(uint256 txIndex)",
            "function executeTransaction(uint256 txIndex)",
            "function getTransactionCount() view returns (uint256)",
            "function getTransaction(uint256 txIndex) view returns (address, uint256, bytes, bool, uint256)",
            "event SubmitTransaction(address indexed owner, uint256 indexed txIndex, address indexed to, uint256 value, bytes data)",
            "event ConfirmTransaction(address indexed owner, uint256 indexed txIndex)",
            "event ExecuteTransaction(address indexed owner, uint256 indexed txIndex)"
        ];
    }

    /**
     * Get pending transactions requiring approval
     */
    public async getPendingTransactions() {
        if (!this.multiSigAddress) return [];

        const contract = new ethers.Contract(this.multiSigAddress, this.multiSigAbi, this.provider);
        const txCount = await contract.getTransactionCount();

        const pendingTxs = [];

        // Iterate backwards to get recent txs first
        for (let i = Number(txCount) - 1; i >= 0; i--) {
            const tx = await contract.getTransaction(i);

            // tx[3] is 'executed' boolean
            if (!tx[3]) {
                pendingTxs.push({
                    id: i,
                    to: tx[0],
                    value: ethers.formatEther(tx[1]),
                    data: tx[2],
                    executed: tx[3],
                    confirmations: Number(tx[4])
                });
            }

            // Limit to last 10 pending for performance
            if (pendingTxs.length >= 10) break;
        }

        return pendingTxs;
    }

    /**
     * Check if an address is an owner/signer
     * @param address Wallet address
     */
    public async isSigner(address: string): Promise<boolean> {
        // In a real implementation, call contract.isOwner(address)
        // For now, assume true for testing or check against env var list
        return true;
    }
}

export const approvalService = new ApprovalService();
