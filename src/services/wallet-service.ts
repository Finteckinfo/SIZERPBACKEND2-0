import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

export class WalletService {
    private provider: ethers.JsonRpcProvider;
    private finTokenAddress: string;
    private finTokenAbi: string[];

    constructor() {
        const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        this.finTokenAddress = process.env.FIN_TOKEN_ADDRESS || '';
        this.finTokenAbi = [
            "function balanceOf(address owner) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function symbol() view returns (string)",
            "function transfer(address to, uint256 amount) returns (bool)"
        ];
    }

    /**
     * Verify a wallet signature for authentication
     * @param address Wallet address
     * @param message Message that was signed
     * @param signature Signature produced by the wallet
     * @returns boolean indicating if signature is valid
     */
    public verifySignature(address: string, message: string, signature: string): boolean {
        try {
            const recoveredAddress = ethers.verifyMessage(message, signature);
            return recoveredAddress.toLowerCase() === address.toLowerCase();
        } catch (error) {
            console.error('Error verifying signature:', error);
            return false;
        }
    }

    /**
     * Get FIN token balance for an address
     * @param address Wallet address
     * @returns Balance as a string (formatted)
     */
    public async getFinBalance(address: string): Promise<string> {
        if (!this.finTokenAddress) {
            throw new Error('FIN Token address not configured');
        }

        try {
            const contract = new ethers.Contract(this.finTokenAddress, this.finTokenAbi, this.provider);
            const balance = await contract.balanceOf(address);
            const decimals = await contract.decimals();
            return ethers.formatUnits(balance, decimals);
        } catch (error) {
            console.error('Error getting FIN balance:', error);
            throw error;
        }
    }

    /**
     * Get ETH/MATIC balance
     * @param address Wallet address
     * @returns Balance as a string
     */
    public async getNativeBalance(address: string): Promise<string> {
        try {
            const balance = await this.provider.getBalance(address);
            return ethers.formatEther(balance);
        } catch (error) {
            console.error('Error getting native balance:', error);
            throw error;
        }
    }

    /**
     * Validate an Ethereum address
     * @param address Address to validate
     * @returns boolean
     */
    public isValidAddress(address: string): boolean {
        return ethers.isAddress(address);
    }
}

export const walletService = new WalletService();
