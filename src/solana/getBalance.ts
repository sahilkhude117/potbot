import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getConnection } from "./getConnection";

const connection = getConnection();

export async function getBalanceMessage(publicKey: string): Promise<{
    empty: boolean,
    message: string,
    balance: number;
}> {
    const balance = await connection.getBalance(new PublicKey(publicKey));
    if (balance) {
        return {
            empty: false,
            message: `Your balance is ${balance / LAMPORTS_PER_SOL} SOL`,
            balance: balance / LAMPORTS_PER_SOL 
        }
    } else {
        return {
            empty: true,
            message: "",
            balance: 0 / LAMPORTS_PER_SOL
        }
    }
}