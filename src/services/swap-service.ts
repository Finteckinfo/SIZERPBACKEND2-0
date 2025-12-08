import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

export class SwapService {
    private provider: ethers.JsonRpcProvider;
    private swapAddress: string;
    private swapAbi: string[];

    constructor() {
        const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        this.swapAddress = process.env.SWAP_CONTRACT_ADDRESS || '';
        this.swapAbi = [
            "function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)",
            "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256)",
            "function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB) returns (uint256)",
            "event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)"
        ];
    }

    /**
     * Get a quote for swapping tokens
     * @param tokenIn Address of token to sell
     * @param tokenOut Address of token to buy
     * @param amountIn Amount of tokenIn to sell
     */
    public async getQuote(tokenIn: string, tokenOut: string, amountIn: string) {
        if (!this.swapAddress) throw new Error('Swap address not configured');

        const contract = new ethers.Contract(this.swapAddress, this.swapAbi, this.provider);
        const amountInWei = ethers.parseEther(amountIn);

        try {
            const amountOutWei = await contract.getAmountOut(tokenIn, tokenOut, amountInWei);
            const amountOut = ethers.formatEther(amountOutWei);

            // Calculate slippage and fee
            // Fee is 0.3%
            const fee = Number(amountIn) * 0.003;
            // Slippage is difference between ideal price and actual execution price (simplified here)
            // In a real AMM, this depends on pool depth
            const slippage = 0.1; // 0.1% placeholder

            return {
                amountOut,
                fee: fee.toString(),
                slippage: slippage.toString()
            };
        } catch (error) {
            console.error('Error getting quote:', error);
            throw error;
        }
    }

    /**
     * Monitor swap events
     */
    public listenForSwaps(callback: (user: string, tokenIn: string, tokenOut: string, amountIn: string, amountOut: string) => void) {
        if (!this.swapAddress) return;

        const contract = new ethers.Contract(this.swapAddress, this.swapAbi, this.provider);
        contract.on("Swap", (user, tokenIn, tokenOut, amountIn, amountOut) => {
            callback(
                user,
                tokenIn,
                tokenOut,
                ethers.formatEther(amountIn),
                ethers.formatEther(amountOut)
            );
        });
    }
}

export const swapService = new SwapService();
