import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

export class EscrowService {
    private provider: ethers.JsonRpcProvider;
    private signer: ethers.Wallet;
    private escrowAddress: string;
    private escrowAbi: string[];

    constructor() {
        const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        // Backend wallet for administrative actions (if needed)
        // In a real production app, use a secure key management system
        const privateKey = process.env.BACKEND_PRIVATE_KEY;
        if (privateKey) {
            this.signer = new ethers.Wallet(privateKey, this.provider);
        } else {
            // Read-only mode if no private key
            console.warn('No backend private key provided. EscrowService running in read-only mode.');
        }

        this.escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || '';
        this.escrowAbi = [
            "function fundProject(uint256 amount) returns (uint256)",
            "function allocateTask(uint256 projectId, address worker, uint256 amount) returns (uint256)",
            "function completeTask(uint256 taskId)",
            "function approvePayment(uint256 taskId)",
            "function requestRefund(uint256 projectId)",
            "function processRefund(uint256 projectId)",
            "function getProject(uint256 projectId) view returns (address, uint256, uint256, uint256, uint8, uint256, uint256)",
            "function getTask(uint256 taskId) view returns (uint256, address, uint256, uint8, uint256, uint256, uint256)",
            "event ProjectFunded(uint256 indexed projectId, address indexed employer, uint256 amount)",
            "event TaskAllocated(uint256 indexed taskId, uint256 indexed projectId, address indexed worker, uint256 amount)",
            "event PaymentReleased(uint256 indexed taskId, address indexed worker, uint256 amount)"
        ];
    }

    /**
     * Get project details from smart contract
     * @param projectId Project ID
     */
    public async getProjectDetails(projectId: number) {
        if (!this.escrowAddress) throw new Error('Escrow address not configured');

        const contract = new ethers.Contract(this.escrowAddress, this.escrowAbi, this.provider);
        const project = await contract.getProject(projectId);

        return {
            employer: project[0],
            totalFunded: ethers.formatEther(project[1]),
            totalAllocated: ethers.formatEther(project[2]),
            totalReleased: ethers.formatEther(project[3]),
            status: Number(project[4]),
            createdAt: new Date(Number(project[5]) * 1000),
            refundRequestedAt: Number(project[6]) > 0 ? new Date(Number(project[6]) * 1000) : null
        };
    }

    /**
     * Get task details from smart contract
     * @param taskId Task ID
     */
    public async getTaskDetails(taskId: number) {
        if (!this.escrowAddress) throw new Error('Escrow address not configured');

        const contract = new ethers.Contract(this.escrowAddress, this.escrowAbi, this.provider);
        const task = await contract.getTask(taskId);

        return {
            projectId: Number(task[0]),
            worker: task[1],
            amount: ethers.formatEther(task[2]),
            status: Number(task[3]),
            createdAt: new Date(Number(task[4]) * 1000),
            completedAt: Number(task[5]) > 0 ? new Date(Number(task[5]) * 1000) : null,
            approvalCount: Number(task[6])
        };
    }

    /**
     * Listen for project funding events
     * @param callback Function to call when event is detected
     */
    public listenForFunding(callback: (projectId: number, employer: string, amount: string) => void) {
        if (!this.escrowAddress) return;

        const contract = new ethers.Contract(this.escrowAddress, this.escrowAbi, this.provider);
        contract.on("ProjectFunded", (projectId, employer, amount) => {
            callback(Number(projectId), employer, ethers.formatEther(amount));
        });
    }
}

export const escrowService = new EscrowService();
