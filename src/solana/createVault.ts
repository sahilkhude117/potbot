import { Keypair } from "@solana/web3.js";
import { createPotWallet, type PotWalletData } from "../lib/walletManager";

// ========================================
// WALLET MODE (Active for Testing)
// ========================================
// Creates a direct wallet for the pot (no smart contract)
export function createPotVault(): PotWalletData {
    return createPotWallet();
}

// ========================================
// SMART CONTRACT MODE (Commented for fallback)
// ========================================
// This creates a seed keypair for on-chain smart contract PDA
// Uncomment when switching back to smart contract mode
export function createPotSeed() {
    const potSeedKeypair = Keypair.generate();

    return {
        publicKey: potSeedKeypair.publicKey.toBase58(),
        secretKey: potSeedKeypair.secretKey.toBase64(), 
    };
}

export function createMockVault() {
    return createPotSeed();
}

