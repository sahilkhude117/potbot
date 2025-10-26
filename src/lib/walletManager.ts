import { Keypair } from "@solana/web3.js";

export interface PotWalletData {
  publicKey: string;
  secretKey: string; 
}

export function createPotWallet(): PotWalletData {
  const keypair = Keypair.generate();
  
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Buffer.from(keypair.secretKey).toString('base64'),
  };
}

export function parseVaultAddress(vaultAddress: string): PotWalletData | null {
  try {
    const parsed = JSON.parse(vaultAddress);
    if (parsed.publicKey && parsed.secretKey) {
      return parsed as PotWalletData;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeWalletData(walletData: PotWalletData): string {
  return JSON.stringify(walletData);
}

export function walletDataToKeypair(walletData: PotWalletData): Keypair {
  const secretKey = Buffer.from(walletData.secretKey, 'base64');
  return Keypair.fromSecretKey(secretKey);
}

export function isWalletBasedPot(vaultAddress: string): boolean {
  return parseVaultAddress(vaultAddress) !== null;
}
