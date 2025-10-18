import { Context, Scenes } from "telegraf";

export interface DepositWizardState extends Scenes.WizardSessionData {
  userId: string;
  potId: string;
  potName: string;
  amount: number;
  userBalance: number;
}

export interface WithdrawalWizardState extends Scenes.WizardSessionData {
    userId: string;
    potId: string;
    potName: string;
    sharesToBurn: bigint;
    userShares: bigint;
}

export interface BuyTokenWizardState {
    userId: string;
    tokenMint: string;
    tokenSymbol?: string;
    quantity: number;
    balance: number;
    quoteData?: any;
    swapTxn?: any;
}

export interface BuyTokenGroupWizardState extends Scenes.WizardSessionData {
    userId: string;
    potId: string;
    tokenMint: string;
    quantity: number;
    vaultBalance: number;
    isAdmin: boolean;
    quoteData: any;
}

export interface SellTokenWizardState extends Scenes.WizardSessionData {
    userId: string;
    tokenMint: string;
    tokenSymbol: string;
    tokenBalance: number;
    tokenDecimals: number;
    quantity: number;
    quoteData?: any;
}

export interface SellTokenGroupWizardState extends Scenes.WizardSessionData {
    userId: string;
    potId: string;
    tokenMint: string;
    tokenSymbol: string;
    tokenBalance: number;
    tokenDecimals: number;
    quantity: number;
    isAdmin: boolean;
    quoteData: any;
    availableTokens?: Array<{
        mintAddress: string;
        balance: number;
        decimals: number;
        symbol: string;
    }>;
}

export interface SessionData extends Scenes.WizardSession<DepositWizardState> {}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, DepositWizardState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}

