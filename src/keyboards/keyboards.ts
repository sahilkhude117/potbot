import { Markup } from "telegraf";

export const DEFAULT_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Show public key", "public_key"),
    Markup.button.callback("Show Balance", "balance"),   
],[
    Markup.button.callback("Create Pot", "create_pot"),
    Markup.button.callback("Join Pot", "join_pot"),
],[
    Markup.button.callback("My Pots", "show_pots")
], [
    Markup.button.callback("Buy", "buy"),
    Markup.button.callback("Sell", "sell")
]]);

export const ADD_POTBOT_TO_GROUP = Markup.inlineKeyboard([[
    Markup.button.url("Add Pot Bot to Group", "https://t.me/solana_pot_bot?startgroup=pot_xyz123")
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
    Markup.button.callback("Buy", "buy_asset_with_solana_group",)
],[
    Markup.button.callback("Portfolio", "portfolio")
]])