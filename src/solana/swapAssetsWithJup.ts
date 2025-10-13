import axios from "axios";

const JUP_URl = "https://lite-api.jup.ag"
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

const SLIPPAGE = 5;

export async function swap(
    inputMint: string,
    outputMint: string,
    quantity: number,
    userPublicKey: string
) {
    let quoteConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${JUP_URl}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${quantity}&slippageBps=${SLIPPAGE}&userPublicKey=${userPublicKey}&platformFeeBps=0&cluster=devnet`,
        headers: { 
            'Accept': 'application/json'
        }
    };

    const response = await axios.request(quoteConfig);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: SWAP_URL,
        headers: { 
            'Content-Type': 'application/json', 
            'Accept': 'application/json'
        },
        data : {quoteResponse: response.data, payer: userPublicKey, userPublicKey: userPublicKey, cluster: "devnet"}
    };

    const swapResponse = await axios.request(config);

    return swapResponse.data.swapTransaction;
}