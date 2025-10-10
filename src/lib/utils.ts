import bs58 from 'bs58';

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function decodeSecretKey(base64String: string): Uint8Array {
  const uint8Array = Uint8Array.fromBase64(base64String);
  return uint8Array;
}
