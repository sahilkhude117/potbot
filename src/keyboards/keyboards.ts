import { Markup } from "telegraf";

export const DEFAULT_KEYBOARD = Markup.inlineKeyboard([[
    Markup.button.callback("Show public key", "public_key"),
    Markup.button.callback("Show Private key", "private_key"),    
],[
    Markup.button.callback("Show Balance", "balance")
]]);
