import * as anchor from "@coral-xyz/anchor";
import assert from "assert";
import * as web3 from "@solana/web3.js";
import type { Constants } from "../target/types/constants";

describe("solana-pot", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Constants as anchor.Program<Constants>;
  
  // Use the globally available objects
  const program = program;
  const admin = program.provider.wallet.payer;
  
  // Generate keypairs for test subjects
  const traderOne = new web3.Keypair();
  const traderTwo = new web3.Keypair();
  const nonAdmin = new web3.Keypair();

  // The PDA for the pot account, which we will calculate
  let potPda;
  let potBump;

  before(async () => {
    // Calculate the PDA for our pot account once before all tests
    [potPda, potBump] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pot"), admin.publicKey.toBuffer()],
      program.programId
    );
    console.log(`Testing with admin: ${admin.publicKey.toBase58()}`);
    console.log(`Pot PDA: ${potPda.toBase58()}`);
  });

  it("Initializes a new pot!", async () => {
    const fees = {
      performanceFeeBps: 1000, // 10%
      redemptionFeeBps: 50,    // 0.5%
    };

    const txHash = await program.methods
      .initializePot(fees)
      .accounts({
        pot: potPda,
        admin: admin.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log(`Initialize transaction hash: ${txHash}`);
    await program.provider.connection.confirmTransaction(txHash);

    const potAccount = await program.account.pot.fetch(potPda);

    assert(potAccount.admin.equals(admin.publicKey), "Admin key does not match");
    assert(potAccount.traders.length === 0, "Traders list should be empty");
    assert(potAccount.fees.performanceFeeBps === 1000, "Performance fee is incorrect");
    assert(potAccount.bump === potBump, "Bump seed is incorrect");
  });

  it("Adds a trader successfully", async () => {
    await program.methods
      .addTrader(traderOne.publicKey)
      .accounts({ pot: potPda, admin: admin.publicKey })
      .rpc();

    const potAccount = await program.account.pot.fetch(potPda);

    assert(potAccount.traders.length === 1, "Should have one trader");
    assert(potAccount.traders[0].equals(traderOne.publicKey), "The wrong trader was added");
  });

  it("Fails to add a trader when not called by the admin", async () => {
    try {
      await program.methods
        .addTrader(traderTwo.publicKey)
        .accounts({ pot: potPda, admin: nonAdmin.publicKey })
        .signers([nonAdmin])
        .rpc();
      
      assert(false, "The transaction should have failed!");
    } catch (err) {
      // Check that the error message contains our custom error name
      assert(err.toString().includes("Unauthorized"), "Expected Unauthorized error");
      console.log("Correctly failed as expected.");
    }
  });

  it("Removes a trader successfully", async () => {
    await program.methods
      .removeTrader(traderOne.publicKey)
      .accounts({ pot: potPda, admin: admin.publicKey })
      .rpc();

    const potAccount = await program.account.pot.fetch(potPda);

    assert(potAccount.traders.length === 0, "Trader list should be empty after removal");
  });

  it("Fails to remove a trader who is not on the list", async () => {
    try {
      await program.methods
        .removeTrader(traderTwo.publicKey)
        .accounts({ pot: potPda, admin: admin.publicKey })
        .rpc();
        
      assert(false, "The transaction should have failed!");
    } catch (err) {
      assert(err.toString().includes("TraderNotFound"), "Expected TraderNotFound error");
      console.log("Correctly failed as expected.");
    }
  });
});