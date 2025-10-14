import { Context, Scenes } from "telegraf";

export interface DepositWizardState extends Scenes.WizardSessionData {
  userId: string;
  potId: string;
  potName: string;
  amount: number;
}

export interface WithdrawalWizardState extends Scenes.WizardSessionData {
    userId: string;
    potId: string;
    potName: string;
    sharesToBurn: bigint;
}

export interface BuyTokenWizardState {
    userId: string;
    tokenMint: string;
    tokenSymbol?: string;
    quantity: number;
    quoteData?: any;
    swapTxn?: any;
}

export interface SessionData extends Scenes.WizardSession<DepositWizardState> {}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, DepositWizardState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}

