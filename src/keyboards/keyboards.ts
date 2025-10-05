import { Markup } from "telegraf";

export const DEFAULT_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Show public key", "public_key"),
    Markup.button.callback("Show Balance", "balance"),   
],[
    Markup.button.callback("Create Pot", "create_pot"),
    Markup.button.callback("Join Pot", "join_pot"),
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

export const CREATE_INVITE_DONE_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Done", "create_invite")
]])