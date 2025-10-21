// Script to calculate Anchor instruction discriminators
import crypto from 'crypto';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256')
    .update(`global:${name}`)
    .digest();
  return hash.subarray(0, 8);
}

const instructions = [
  'initialize_pot',
  'add_trader',
  'remove_trader',
  'deposit',
  'redeem',
  'set_swap_delegate',
  'revoke_swap_delegate'
];

console.log('Anchor Instruction Discriminators:\n');

for (const instruction of instructions) {
  const discriminator = getDiscriminator(instruction);
  const bytes = Array.from(discriminator);
  console.log(`${instruction}:`);
  console.log(`  Buffer: Buffer.from([${bytes.join(', ')}])`);
  console.log(`  Hex: ${discriminator.toString('hex')}\n`);
}
