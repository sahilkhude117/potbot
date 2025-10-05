import { Keypair } from "@solana/web3.js";

export function createMockVault() {
    const vaultKeypair = Keypair.generate();

    return {
        publicKey: vaultKeypair.publicKey.toBase58(),
        secretKey: vaultKeypair.secretKey.toBase64(),
    };
}

