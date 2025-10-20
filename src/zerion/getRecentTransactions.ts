import axios from 'axios';

const ZERION_API_BASE_URL = 'https://api.zerion.io';
const ZERION_API_KEY_BS64 = process.env.ZERION_API_KEY_BS64;

interface TransactionChange {
  asset: {
    fungible_info?: {
      name: string;
      symbol: string;
      icon?: {
        url: string;
      };
    };
  };
  value: number;
  price: number;
  direction: 'in' | 'out';
}

interface Transaction {
  id: string;
  type: string;
  attributes: {
    operation_type: string;
    hash: string;
    mined_at: number;
    sent_from: string;
    sent_to: string;
    status: string;
    fee: {
      fungible_info: {
        name: string;
        symbol: string;
      };
      value: number;
      price: number;
    };
    transfers: TransactionChange[];
    approvals: any[];
  };
  relationships?: {
    chain: {
      data: {
        id: string;
      };
    };
  };
}

interface ZerionTransactionsResponse {
  links: {
    self: string;
  };
  data: Transaction[];
}

export interface FormattedTransaction {
  hash: string;
  type: string;
  status: string;
  timestamp: number;
  date: string;
  chain: string;
  from: string;
  to: string;
  fee: {
    amount: number;
    symbol: string;
    valueUSD: number;
  };
  transfers: {
    asset: string;
    symbol: string;
    amount: number;
    direction: 'in' | 'out';
    valueUSD: number;
  }[];
}


export async function getRecentTransactions(
  walletAddress: string,
  limit: number = 5,
  chainIds?: string[]
): Promise<FormattedTransaction[]> {
  if (!ZERION_API_KEY_BS64) {
    throw new Error('ZERION_API_KEY_BS64 environment variable is not set');
  }

  try {
    const params: any = {
      'page[size]': limit,
      'sort': '-mined_at',
    };

    if (chainIds && chainIds.length > 0) {
      params['filter[chain_ids]'] = chainIds.join(',');
    }

    const response = await axios.get<ZerionTransactionsResponse>(
      `${ZERION_API_BASE_URL}/v1/wallets/${walletAddress}/transactions/`,
      {
        headers: {
          'Authorization': `Basic ${ZERION_API_KEY_BS64}`,
        },
        params,
      }
    );

    return response.data.data.map((tx) => formatTransaction(tx));
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Zerion API Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      throw new Error(
        `Failed to fetch transactions: ${error.response?.data?.errors?.[0]?.title || error.message}`
      );
    }
    throw error;
  }
}

function formatTransaction(tx: Transaction): FormattedTransaction {
  const attributes = tx.attributes;
  const chainId = tx.relationships?.chain?.data?.id || 'unknown';

  return {
    hash: attributes.hash,
    type: attributes.operation_type,
    status: attributes.status,
    timestamp: attributes.mined_at,
    date: new Date(attributes.mined_at).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    chain: chainId,
    from: attributes.sent_from,
    to: attributes.sent_to,
    fee: {
      amount: attributes.fee?.value || 0,
      symbol: attributes.fee?.fungible_info?.symbol || '',
      valueUSD: attributes.fee?.price || 0,
    },
    transfers: attributes.transfers.map((transfer) => ({
      asset: transfer.asset?.fungible_info?.name || 'Unknown',
      symbol: transfer.asset?.fungible_info?.symbol || '???',
      amount: transfer.value,
      direction: transfer.direction,
      valueUSD: transfer.price,
    })),
  };
}

export function formatTransactionsMessage(
  transactions: FormattedTransaction[],
  walletAddress: string,
  cluster: string = 'devnet'
): string {
  if (transactions.length === 0) {
    return `*📊 Recent Transactions*\n\n` +
           `No transactions found for wallet:\n` +
           `\`${escapeMarkdownV2(walletAddress)}\``;
  }

  let message = `*📊 Recent Transactions*\n\n`;
  message += `Wallet: \`${escapeMarkdownV2(walletAddress)}\`\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  transactions.forEach((tx, index) => {
    const typeEmoji = getTypeEmoji(tx.type);
    const statusEmoji = tx.status === 'confirmed' ? '✅' : '⏳';
    
    message += `${typeEmoji} *${escapeMarkdownV2(tx.type.toUpperCase())}* ${statusEmoji}\n`;

    if (tx.transfers.length > 0) {
      message += `┣ Transfers:\n`;

      const isTrade = tx.type.toLowerCase() === 'trade';
      
      tx.transfers.forEach((transfer, i) => {
        const isLastTransfer = i === tx.transfers.length - 1;
        const prefix = '┣';
        
        let displaySymbol = transfer.symbol;
        if (transfer.symbol === '???' || transfer.symbol === 'Unknown' || !transfer.symbol) {
          displaySymbol = 'Unknown';
        }

        if (isTrade) {
          const directionLabel = transfer.direction === 'in' ? 'IN' : 'OUT';
          message += `${prefix}   ${escapeMarkdownV2(directionLabel)}: ${escapeMarkdownV2(formatAmount(transfer.amount))} ${escapeMarkdownV2(displaySymbol)} `;
        } else {
          const directionEmoji = transfer.direction === 'in' ? '📥' : '📤';
          message += `${prefix}   ${directionEmoji} ${escapeMarkdownV2(formatAmount(transfer.amount))} ${escapeMarkdownV2(displaySymbol)} `;
        }
        
        message += `\\(\`\\$${escapeMarkdownV2(formatAmount(transfer.valueUSD))}\`\\)\n`;
      });
    }

    message += `┣ 🔗 [View Transaction](https://explorer.solana.com/tx/${tx.hash}?cluster=devnet)\n`;

    message += `┗ Date: \`${escapeMarkdownV2(tx.date)}\`\n`;
    
    if (index < transactions.length - 1) {
      message += `\n`;
    }
  });

  return message;
}


function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function formatAmount(amount: number): string {
  if (amount === 0) return '0';
  if (amount < 0.000001) return amount.toExponential(2);
  if (amount < 1) return amount.toFixed(6);
  if (amount < 1000) return amount.toFixed(4);
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function getTypeEmoji(type: string): string {
  const emojiMap: { [key: string]: string } = {
    'trade': '🔄',
    'send': '📤',
    'receive': '📥',
    'mint': '🎨',
    'burn': '🔥',
    'approve': '✅',
    'revoke': '❌',
    'deposit': '💰',
    'withdraw': '💸',
    'stake': '🔒',
    'unstake': '🔓',
    'borrow': '🏦',
    'repay': '💳',
    'claim': '🎁',
  };
  
  return emojiMap[type.toLowerCase()] || '📝';
}
