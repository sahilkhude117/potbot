import { Connection } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL!

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}