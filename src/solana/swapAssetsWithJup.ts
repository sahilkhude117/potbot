import axios from "axios";

const JUP_URl = "https://lite-api.jup.ag";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const SLIPPAGE = 50;


export async function getQuote(
    inputMint: string,
    outputMint: string,
    quantity: number,
    userPublicKey: string
) {
    let quoteConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${JUP_URl}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${quantity}&slippageBps=${SLIPPAGE}&userPublicKey=${userPublicKey}&platformFeeBps=0`,
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
            payer: userPublicKey, 
            userPublicKey: userPublicKey, 
            cluster: "devnet"
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