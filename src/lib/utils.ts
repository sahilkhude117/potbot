
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function escapeMarkdownV2Amount(amount: number): string {
  const str = amount.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""); 
  return str.replace(/\./g, "\\.");
}

export function decodeSecretKey(base64String: string): Uint8Array {
  const uint8Array = Uint8Array.fromBase64(base64String);
  return uint8Array;
}

