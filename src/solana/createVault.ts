import { Keypair } from "@solana/web3.js";

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

