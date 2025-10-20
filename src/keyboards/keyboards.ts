import { Markup } from "telegraf";

export const DEFAULT_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Show Public key", "public_key"),
    Markup.button.callback("Show Balance", "balance"),   
    Markup.button.callback("Export Private key", "private_key"),   
],[
    Markup.button.callback("Create Pot", "create_pot"),
    Markup.button.callback("Join Pot", "join_pot"),
    Markup.button.callback("My Pots", "show_pots")
],[
    Markup.button.callback("Deposit to Pot", "deposit"),
    Markup.button.callback("Withdraw from Pot", "withdraw")
],[
    Markup.button.callback("Buy Tokens", "buy"),
    Markup.button.callback("Sell Tokens", "sell")
],[
    Markup.button.callback("Start Copy Trading", "copy_trading")
],[
    Markup.button.callback("Recent Transactions", "recent_transactions"),
    Markup.button.callback("View Portfolio", 'portfolio'),
]]);

export const ADD_POTBOT_TO_GROUP = Markup.inlineKeyboard([[
    Markup.button.url("Add Pot Bot to Group", "https://t.me/solana_pot_bot?startgroup=pot_xyz123")
]])

export const ADD_POTBOT_TO_GROUP_WITH_DONE = Markup.inlineKeyboard([[
    Markup.button.url("Add Pot Bot to Group", "https://t.me/solana_pot_bot?startgroup=pot_xyz123")
],[
    Markup.button.callback("Done", "show_pots")
]])

export const CREATE_NEW_POT = Markup.inlineKeyboard([[
    Markup.button.url("Create New Pot", "https://t.me/solana_pot_bot?start=create_new_bot")
]])

export const SOLANA_POT_BOT = Markup.inlineKeyboard([[
    Markup.button.url("Go to Pot Bot", "https://t.me/solana_pot_bot")
]])

export const SOLANA_POT_BOT_WITH_START_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.url("Chat with Bot Privately", "https://t.me/solana_pot_bot?start=welcome")
]])

export const CREATE_INVITE_DONE_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Done", "create_invite")
]])

export const CHECK_BALANCE_KEYBOARD = Markup.inlineKeyboard([
    Markup.button.callback("Check Balance", "balance"),  
])

export const DEFAULT_GROUP_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Buy Tokens", "buy_token_with_solana_group"),
    Markup.button.callback("Sell Tokens", "sell_token_for_solana_group")
],[
    Markup.button.callback("View Portfolio", "portfolio")
]])