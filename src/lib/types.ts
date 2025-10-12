import { Context, Scenes } from "telegraf";

export interface DepositWizardState extends Scenes.WizardSessionData {
  userId: string;
  potId: string;
  potName: string;
  amount: number;
}

export interface MintSharesInput {
  potId: string;
  userId: string;
  lamportsDeposited: bigint;
}

export interface SessionData extends Scenes.WizardSession<DepositWizardState> {}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, DepositWizardState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}

