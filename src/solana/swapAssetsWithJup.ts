import axios from "axios";
import { getCluster } from "./getConnection";

const JUP_URL = "https://lite-api.jup.ag";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const SLIPPAGE = 50;
const PLATFORM_FEE_BPS = 100; // 1%
const FEE_ACCOUNT_PUBLIC_KEY = ""


export async function getQuote(
    inputMint: string,
    outputMint: string,
    quantity: number,
    userPublicKey: string
) {
    const cluster = getCluster();
    
    let quoteConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${JUP_URL}/swap/v1/quote?inputMint=${inputMint}` +
                `&outputMint=${outputMint}` +
                `&amount=${quantity}` +
                `&slippageBps=${SLIPPAGE}` +
                `&userPublicKey=${userPublicKey}` +
                `&platformFeeBps=${PLATFORM_FEE_BPS}`,
        headers: { 
            'Accept': 'application/json'
        }
    };

    const response = await axios.request(quoteConfig);
    return response.data;
}

export async function executeSwap(
    quoteResponse: any,
    userPublicKey: string
) {
    const cluster = getCluster();
    
    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: SWAP_URL,
        headers: { 
            'Content-Type': 'application/json', 
            'Accept': 'application/json'
        },
        data: {
            quoteResponse: quoteResponse,
            userPublicKey: userPublicKey,
            payer: userPublicKey,
            feeAccount: FEE_ACCOUNT_PUBLIC_KEY,
            cluster: cluster,
        }
    };

    const swapResponse = await axios.request(config);
    return swapResponse.data.swapTransaction;
}

export async function swap(
    inputMint: string,
    outputMint: string,
    quantity: number,
    userPublicKey: string
) {
    const quoteResponse = await getQuote(inputMint, outputMint, quantity, userPublicKey);
    return await executeSwap(quoteResponse, userPublicKey);
}