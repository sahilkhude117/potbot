1. Integrating the deposit Instruction
The goal is to replace the core logic inside your wizard_confirm_deposit handler. Instead of calling sendSol and then mintSharesAndDeposit, you will now build and send a single transaction to the smart contract.

Step 1: Find All Required Account Keys
Before you can build the transaction, you need to gather or derive all the public keys required by the Deposit instruction's context.

TypeScript

// Inside your 'wizard_confirm_deposit' action handler...

// 1. User's Public Key (you already have this)
const userPublicKey = new PublicKey(user.publicKey);

// 2. Pot PDA Address (you have the adminId from the pot record)
const [potPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pot"), new PublicKey(pot.adminId).toBuffer()],
    program.programId
);

// 3. MemberData PDA Address (this is the user's on-chain share account)
const [memberDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), potPda.toBuffer(), userPublicKey.toBuffer()],
    program.programId
);

// 4. Pot's Associated Token Account (ATA) for the base mint
const potVaultAta = await getAssociatedTokenAddress(
    WRAPPED_SOL_MINT, // The mint of the token being deposited
    potPda,           // The PDA is the owner
    true              // Allow PDA owner
);

// 5. User's Associated Token Account (ATA)
const userVaultAta = await getAssociatedTokenAddress(
    WRAPPED_SOL_MINT,
    userPublicKey
);
Step 2: Build and Send the Transaction
Now, construct the instruction call using the keys you just found. The amount should be in its smallest unit (lamports).

TypeScript

// Convert the deposit amount to lamports (u64)
const depositAmountLamports = new anchor.BN(amount * LAMPORTS_PER_SOL);

try {
    const txSignature = await program.methods
        .deposit(depositAmountLamports)
        .accounts({
            user: userPublicKey,
            memberData: memberDataPda,
            pot: potPda,
            baseMint: WRAPPED_SOL_MINT,
            potVault: potVaultAta,
            userVault: userVaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([fromKeypair]) // The user's keypair must sign
        .rpc();

    // The transaction was successful!
    // The smart contract handled the transfer and share minting.
    await ctx.reply(`✅ Deposit successful! Tx: ${txSignature}`);

} catch (err) {
    console.error("On-chain deposit failed:", err);
    await ctx.reply("❌ Your on-chain deposit failed. Please try again.");
}
2. Integrating the redeem (Withdrawal) Instruction
Similarly, you'll update your wizard_confirm_withdrawal handler. Instead of calling burnSharesAndWithdraw and then transferAssets, you'll call the redeem instruction.

Step 1: Find All Required Account Keys
The accounts are very similar to the deposit, but pay attention to the admin account needed for the pot PDA seeds.

TypeScript

// Inside your 'wizard_confirm_withdrawal' action handler...

// 1. User's Public Key
const userPublicKey = new PublicKey(user.publicKey);

// 2. Pot's Admin Public Key (needed for pot PDA derivation)
const adminPublicKey = new PublicKey(pot.adminId);

// 3. Pot PDA Address
const [potPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pot"), adminPublicKey.toBuffer()],
    program.programId
);

// 4. MemberData PDA Address
const [memberDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), potPda.toBuffer(), userPublicKey.toBuffer()],
    program.programId
);

// 5. Pot's and User's ATAs (same logic as deposit)
const potVaultAta = await getAssociatedTokenAddress(WRAPPED_SOL_MINT, potPda, true);
const userVaultAta = await getAssociatedTokenAddress(WRAPPED_SOL_MINT, userPublicKey);
Step 2: Build and Send the Transaction
The sharesToBurn value comes from your wizard state.

TypeScript

// The number of shares to burn, as a u64
const sharesToBurnBN = new anchor.BN(sharesToBurn.toString());

try {
    const txSignature = await program.methods
        .redeem(sharesToBurnBN)
        .accounts({
            user: userPublicKey,
            memberData: memberDataPda,
            pot: potPda,
            admin: adminPublicKey, // Must be passed for has_one check and PDA derivation
            potVault: potVaultAta,
            userVault: userVaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair]) // User's keypair signs
        .rpc();

    // The smart contract handled burning shares and transferring the funds.
    await ctx.reply(`✅ Withdrawal successful! Tx: ${txSignature}`);

} catch (err) {
    console.error("On-chain redemption failed:", err);
    await ctx.reply("❌ Your on-chain withdrawal failed. Please try again.");
}