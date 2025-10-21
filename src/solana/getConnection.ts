import { Connection } from "@solana/web3.js";

const SOLANA_CLUSTER = process.env.SOLANA_CLUSTER || 'devnet';
const RPC_URL = SOLANA_CLUSTER === 'devnet' 
  ? process.env.RPC_URL! 
  : process.env.MAINNET_RPC_URL!;

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function getCluster(): 'devnet' | 'mainnet-beta' {
  return SOLANA_CLUSTER === 'mainnet' ? 'mainnet-beta' : 'devnet';
}

export function getExplorerUrl(txId: string): string {
  const cluster = getCluster();
  const baseUrl = `https://explorer.solana.com/tx/${txId}`;
  return cluster === 'devnet' ? `${baseUrl}?cluster=devnet` : baseUrl;
}