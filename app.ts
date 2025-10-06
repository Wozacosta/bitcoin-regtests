import Client from "bitcoin-core";
import { argv } from "process";
import readline from "readline";

// fetched from bitcoin.conf
const client: any = new Client({
  version: "0.24.1",
  // username: "admin1",
  // password: "123",
  // host: "http://localhost:18443",
  username: "user",
  password: "pass",
  host: "http://localhost:18443",
});

async function loadWallet(name) {
  try {
    const res = await client.command("createwallet", name);
    console.log("Created and loaded wallet:", res);
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log("Wallet already exists. Attempting to load.");
      try {
        await client.command("loadwallet", name);
        console.log("Wallet loaded successfully.");
      } catch (loadErr) {
        if (loadErr.message.includes("already loaded")) {
          console.log("Wallet already loaded.");
        } else {
          console.error("Failed to load wallet:", loadErr);
        }
      }
    } else {
      console.error("Failed to create wallet:", e);
    }
  }
}

async function mineToWalletAddress(param) {
  const address = await client.getNewAddress();
  const nbBlocks = parseInt(param);
  await client.command("generatetoaddress", nbBlocks, address);
  console.log(`Mined ${nbBlocks} blocks to: ${address}`);
}
const FEES = 0.0001;

const waitForUserInput = () => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Press Enter to continue", () => {
      rl.close();
      resolve();
    });
  });
};

const mineMany = async (address) => {
  // const newBlock = await client.command("generate");
  const newBlock = await client.generateToAddress({
    nblocks: 100,
    address,
  });
  console.log({ newBlock });
};

const mineBlock = async (address) => {
  // const newBlock = await client.command("generate");
  const newBlock = await client.generateToAddress({
    nblocks: 1,
    address,
  });
  console.log({ newBlock });
};

const mineTo = async (recipientAddress) => {
  // Mine a block to confirm the transaction
  await mineBlock(recipientAddress);
};

/*
 * Note that it sets the input sequence to 4294967293, <=0xFFFFFFFD — Replace By Fee (RBF).
 */
const sendTo = async (recipientAddress, amount) => {
  if (!recipientAddress || amount <= 0) {
    console.error(
      "Invalid parameters: Provide a valid recipient address and positive amount.",
    );
    return;
  }

  console.log(`Sending ${amount} BTC to ${recipientAddress}...`);

  try {
    // Step 1: Send the specified amount to the recipient address
    const txSendToAddress = await client.sendToAddress({
      address: recipientAddress,
      amount: amount,
    });

    console.log(`Transaction initiated! TXID: ${txSendToAddress}`);

    // Step 2: Fetch transaction details
    let tx = await client.getTransaction({
      txid: txSendToAddress,
      verbose: true,
    });

    console.log(
      "Transaction Details (before mining):",
      JSON.stringify(tx, null, 2),
    );

    // Step 4: Fetch updated transaction details after confirmation
    tx = await client.getTransaction({
      txid: txSendToAddress,
      verbose: true,
    });

    console.log(
      "Transaction Details (after mining):",
      JSON.stringify(tx, null, 2),
    );
  } catch (error) {
    console.error("Error in sendToAddress:", error.message);
  }
};
const sendToMany = async (recipientAddress, amount, times) => {
  // calls sendTo times times
  for (let i = 0; i < times; i++) {
    await sendTo(recipientAddress, amount);
  }
};

const sendAutomatedRaw = async (destinationAddress, amount) => {
  if (!destinationAddress || amount <= 0) {
    console.error(
      "Invalid parameters: Provide a valid address and positive amount.",
    );
    return;
  }

  console.log(
    `Creating raw transaction: Sending ${amount} BTC to ${destinationAddress}...`,
  );

  try {
    // Step 1: Create an unfinished raw transaction (no inputs, outputs only)
    const unfinishedTx = await client.createRawTransaction({
      inputs: [],
      outputs: {
        [destinationAddress]: amount,
      },
    });

    // Step 2: Fund the transaction (Bitcoin Core automatically selects UTXOs)
    const fundedTx = await client.fundRawTransaction({
      hexstring: unfinishedTx,
      options: { replaceable: true }, // Set to true if RBF is needed
      // if replaceable: false, sequence of vin set to 4294967294 (0xFFFFFFFE) // Locktime BUT non-rbf
      // else, sets to: 4294967293 // Locktime & RBF
    });

    console.log("Funded Transaction:", fundedTx);

    // Step 3: Decode the transaction for debugging
    const decodedTx = await client.decodeRawTransaction({
      hexstring: fundedTx.hex,
    });
    console.log("Decoded Transaction:", JSON.stringify(decodedTx, null, 2));

    // Step 4: Sign the transaction
    const signedTxHex = await client.signRawTransactionWithWallet({
      hexstring: fundedTx.hex,
    });

    console.log("Signed Transaction Hex:", signedTxHex.hex);

    // Step 5: Broadcast the transaction to the network
    const transactionId = await client.sendRawTransaction({
      hexstring: signedTxHex.hex,
    });

    console.log(`Transaction Broadcasted! TXID: ${transactionId}`);
  } catch (error) {
    console.error("Error sending transaction:", error.message);
  }
};

/*
 * Two outputs to addresses of the same xpub
 */
const sendRawTwoOutputs = async (
  address1,
  address2,
  amount,
  sequence = 4294967294,
) => {
  if (!address1 || !address2 || amount <= 0) {
    console.error(
      "Invalid parameters: Provide a valid address and positive amount.",
    );
    return;
  }

  console.log(
    `Creating raw transaction: Sending ${amount} BTC to ${address1} & ${address2} with sequence=${sequence}...`,
  );

  try {
    // Step 2: Get new addresses
    const newAddress = await client.getNewAddress({ address_type: "legacy" });
    const changeAddress = await client.getRawChangeAddress({
      address_type: "legacy",
    });
    console.log({ newAddress, changeAddress });

    // Step 3: Get UTXO for spending
    const unspents = await client.listUnspent({
      // query_options: { maximumCount: 1 },
    });
    let id = 0;
    let unspent = unspents[id];

    while (unspent.amount < amount) {
      console.warn("Insufficient funds. Picking another UTXO.");
      id++;
      unspent = unspents[id];
    }

    console.log({ unspent });

    // Step 4: Calculate change
    const changeAmountStr = Number(unspent.amount - amount - FEES).toFixed(5);
    const changeAmount = Number(changeAmountStr);

    if (changeAmount < 0) {
      console.warn("Insufficient funds after fees.");
      return;
    }

    console.log({
      changeAmount,
      recipientAmount: amount,
      remainingBalance: unspent.amount - changeAmount - amount,
    });

    // Step 5: Create raw transaction
    const rawTxHex = await client.createRawTransaction({
      inputs: [
        {
          txid: unspent.txid,
          vout: unspent.vout,
          sequence: sequence,
        },
      ],
      outputs: {
        [address1]: amount - 0.1,
        [address2]: 0.1,
        [changeAddress]: changeAmount,
      },
    });

    console.log("Raw Transaction Hex:", rawTxHex);
    const decodedTx = await client.decodeRawTransaction({
      hexstring: rawTxHex,
    });
    console.log("Decoded Transaction:", JSON.stringify(decodedTx, null, 2));

    // Step 6: Sign the transaction
    const signedTxHex = await client.signRawTransactionWithWallet({
      hexstring: rawTxHex,
    });

    console.log("Signed Transaction Hex:", signedTxHex.hex);

    // Step 7: Broadcast the transaction
    const txId = await client.sendRawTransaction({
      hexstring: signedTxHex.hex,
    });

    console.log(`Transaction Broadcasted! TXID: ${txId}`);

    // Step 8: Fetch transaction details
    let tx = await client.getTransaction({ txid: txId, verbose: true });
    console.log("Transaction Details:", JSON.stringify(tx, null, 2));

    // Step 9: Mine a block to confirm the transaction
    await mineBlock(newAddress);
  } catch (error) {
    console.error("Error in sendRaw:", error.message);
    console.error({ error });
  }
};

/*
 * https://learnmeabitcoin.com/technical/transaction/input/sequence/
 * NOTE: You only need to set one of the sequence fields to enable locktime or RBF
 * (even if you have multiple inputs and sequence fields in one transaction)
 * However, relative locktime settings are specific to each input.
 *
 * If set to 0xFFFFFFFE (4294967294) → Locktime / Non-RBF
*  If set to a number ≤ 0x0000FFFF (65535) → Blocks-based timelock.
*  Sequence	Effect
8  0xFFFFFFFE (4294967294)	Default (Non-RBF): Cannot be replaced
* 0xFFFFFFFD (4294967293)	Opt-in RBF: Can be replaced by a higher fee transaction
*
*
* Called like this as you've got more control over all the inputs
 */
const sendRaw = async (recipientAddress, amount, sequence = 4294967294) => {
  if (!recipientAddress || amount <= 0) {
    console.error(
      "Invalid parameters: Provide a valid address and positive amount.",
    );
    return;
  }

  console.log(
    `Creating raw transaction: Sending ${amount} BTC to ${recipientAddress} with sequence=${sequence}...`,
  );

  try {
    // Step 2: Get new addresses
    const newAddress = await client.getNewAddress({ address_type: "legacy" });
    const changeAddress = await client.getRawChangeAddress({
      address_type: "legacy",
    });
    console.log({ newAddress, changeAddress });

    // Step 3: Get UTXO for spending
    const unspents = await client.listUnspent({
      // query_options: { maximumCount: 1 },
    });
    let id = 0;
    let unspent = unspents[id];

    while (unspent.amount < amount) {
      console.warn("Insufficient funds. Picking another UTXO.");
      id++;
      unspent = unspents[id];
    }

    console.log({ unspent });

    // Step 4: Calculate change
    const changeAmountStr = Number(unspent.amount - amount - FEES).toFixed(6);
    const changeAmount = Number(changeAmountStr);

    if (changeAmount < 0) {
      console.warn("Insufficient funds after fees.");
      return;
    }

    console.log({
      changeAmount,
      recipientAmount: amount,
      remainingBalance: unspent.amount - changeAmount - amount,
    });

    // Step 5: Create raw transaction
    const rawTxHex = await client.createRawTransaction({
      inputs: [
        {
          txid: unspent.txid,
          vout: unspent.vout,
          sequence: sequence,
        },
      ],
      outputs: {
        [recipientAddress]: amount,
        [changeAddress]: changeAmount,
      },
    });

    console.log("Raw Transaction Hex:", rawTxHex);
    const decodedTx = await client.decodeRawTransaction({
      hexstring: rawTxHex,
    });
    console.log("Decoded Transaction:", JSON.stringify(decodedTx, null, 2));

    // Step 6: Sign the transaction
    const signedTxHex = await client.signRawTransactionWithWallet({
      hexstring: rawTxHex,
    });

    console.log("Signed Transaction Hex:", signedTxHex.hex);

    // Step 7: Broadcast the transaction
    const txId = await client.sendRawTransaction({
      hexstring: signedTxHex.hex,
    });

    console.log(`Transaction Broadcasted! TXID: ${txId}`);

    // Step 8: Fetch transaction details
    let tx = await client.getTransaction({ txid: txId, verbose: true });
    console.log("Transaction Details:", JSON.stringify(tx, null, 2));

    // Step 9: Mine a block to confirm the transaction
    await mineBlock(newAddress);
  } catch (error) {
    console.error("Error in sendRaw:", error.message);
    console.error({ error });
  }
};

const sendReplaceableTransaction = async (recipientAddress, amount) => {
  if (!recipientAddress || amount <= 0) {
    console.error(
      "Invalid parameters: Provide a valid address and positive amount.",
    );
    return;
  }

  console.log(
    `Sending replaceable transaction to ${recipientAddress} with amount ${amount} BTC...`,
  );

  try {
    // Used for LL account to send funds to
    const btcNodeAddress = await client.getNewAddress({
      address_type: "legacy",
    });

    // Step 1: Get an unspent UTXO
    const unspent = await client.listUnspent({
      query_options: { minimumSumAmount: amount },
    });

    if (!unspent.length) {
      console.error("No suitable UTXOs available.");
      return;
    }

    const utxo = unspent[0];

    // Step 2: Create the first replaceable transaction (RBF enabled)
    const rawTx1 = await client.createRawTransaction({
      inputs: [
        {
          txid: utxo.txid,
          vout: utxo.vout,
          sequence: 4294967293, // RBF enabled
        },
      ],
      outputs: {
        [recipientAddress]: amount,
      },
    });

    // Step 3: Fund & Sign the first transaction
    const fundedTx1 = await client.fundRawTransaction({
      hexstring: rawTx1,
      options: { feeRate: 0.0002 }, // Increase fee rate
    });
    const signedTx1 = await client.signRawTransactionWithWallet({
      hexstring: fundedTx1.hex,
    });

    // Step 4: Broadcast the first transaction
    const txId1 = await client.sendRawTransaction({ hexstring: signedTx1.hex });
    console.log(
      `First transaction sent (TXID: ${txId1}), waiting before replacing...`,
    );
    console.log(
      `If you need to, make a tx that sends funds to ${btcNodeAddress}`,
    );

    await waitForUserInput();
    // Step 5: Create the second transaction (higher fee to replace)
    const rawTx2 = await client.createRawTransaction({
      inputs: [
        {
          txid: utxo.txid,
          vout: utxo.vout,
          sequence: 4294967293, // RBF enabled
        },
      ],
      outputs: {
        [recipientAddress]: amount, // Same amount
      },
    });

    // Step 6: Increase the fee for the replacement transaction
    const fundedTx2 = await client.fundRawTransaction({
      hexstring: rawTx2,
      options: { feeRate: 0.0004 }, // Increase fee rate
    });

    const signedTx2 = await client.signRawTransactionWithWallet({
      hexstring: fundedTx2.hex,
    });

    // Step 7: Broadcast the second transaction, replacing the first
    const txId2 = await client.sendRawTransaction({ hexstring: signedTx2.hex });
    console.log(
      `Replacement transaction sent (TXID: ${txId2}), should replace the first.`,
    );
  } catch (error) {
    console.error("Error in sendReplaceableTransaction:", error.message);
  }
};

// NOTE: should rename, it instead tests the replaceability
const attemptDoubleSpend = async (recipientAddress) => {
  if (!recipientAddress) {
    console.error("Invalid parameter: Provide a valid recipient address.");
    return;
  }

  console.log(`Attempting double spend to ${recipientAddress}...`);

  try {
    // Step 1: Get available UTXOs
    const utxos = await client.listUnspent();
    if (utxos.length < 1) {
      console.warn("Not enough UTXOs to double-spend.");
      return;
    }

    const utxo = utxos[0]; // Use the first available UTXO
    console.log({ utxo });

    const amount = Number(Number(utxo.amount - FEES).toFixed(6));

    // Step 2: Create two transactions using the same UTXO
    const rawTx1 = await client.createRawTransaction({
      inputs: [{ txid: utxo.txid, vout: utxo.vout }],
      outputs: { [recipientAddress]: amount },
    });

    const rawTx2 = await client.createRawTransaction({
      inputs: [{ txid: utxo.txid, vout: utxo.vout, sequence: 4294967295 }],
      outputs: { [recipientAddress]: amount - FEES }, // MORE FEES, SO THAT IT REPLACES THE FIRST
    });

    // Step 3: Sign both transactions
    const signedTx1 = await client.signRawTransactionWithWallet({
      hexstring: rawTx1,
    });
    const signedTx2 = await client.signRawTransactionWithWallet({
      hexstring: rawTx2,
    });
    console.log({ signedTx1, signedTx2 });

    // Step 4: Broadcast the first transaction
    const txId1 = await client.sendRawTransaction({ hexstring: signedTx1.hex });
    console.log("First transaction sent:", txId1);

    // Step 5: Attempt to broadcast the second transaction (should fail)
    try {
      const txId2 = await client.sendRawTransaction({
        hexstring: signedTx2.hex,
      });
      console.log("Second transaction sent (should fail):", txId2);
    } catch (error) {
      console.error("Double-spend rejected as expected:", error.message);
    }
  } catch (error) {
    console.error("Error in attemptDoubleSpend:", error.message);
    console.log({ error });
  }
};

// NOTE: blocked on node side, not worth tweaking with the conf imo
const createDustTransaction = async (recipientAddress) => {
  if (!recipientAddress) {
    console.error("Invalid parameter: Provide a valid recipient address.");
    return;
  }

  console.log(`Creating a dust transaction to ${recipientAddress}...`);

  try {
    // Step 1: Create a dust-sized raw transaction
    const rawTx = await client.createRawTransaction({
      inputs: [],
      outputs: { [recipientAddress]: 0.00000001 }, // Extremely small output (dust)
    });

    // Step 2: Fund the transaction (Bitcoin Core selects UTXOs)
    const fundedTx = await client.fundRawTransaction({ hexstring: rawTx });

    console.log("Funded Transaction:", fundedTx);

    // Step 3: Sign the transaction
    const signedTx = await client.signRawTransactionWithWallet({
      hexstring: fundedTx.hex,
    });

    console.log("Signed Transaction Hex:", signedTx.hex);

    // Step 4: Attempt to broadcast the transaction
    try {
      const txId = await client.sendRawTransaction({ hexstring: signedTx.hex });
      console.log("Dust transaction sent! TXID:", txId);
    } catch (error) {
      console.error(
        "Dust transaction failed as expected (likely due to dust limits):",
        error.message,
      );
    }
  } catch (error) {
    console.error("Error in createDustTransaction:", error.message);
  }
};

const createMultisigTransaction = async (recipientPubKey) => {
  if (!recipientPubKey) {
    console.error("Invalid parameter: Provide a valid recipient pubkey.");
    return;
  }

  console.log(`Creating a multisig transaction to ${recipientPubKey}...`);

  try {
    // Step 1: Generate additional addresses for the multisig wallet
    const key1 = await client.getNewAddress();
    const key2 = await client.getNewAddress();

    console.log(`Generated additional multisig keys: ${key1}, ${key2}`);

    // Step 2: Get public keys for these addresses
    const pubKey1 = await client
      .getAddressInfo({ address: key1 })
      .then((info) => info.pubkey);
    const pubKey2 = await client
      .getAddressInfo({ address: key2 })
      .then((info) => info.pubkey);
    const pubKeyRecipient = recipientPubKey;
    // await client
    //   .getAddressInfo({ address: recipientAddress })
    //   .then((info) => info.pubkey);

    console.log(
      `Generated public keys: ${pubKeyRecipient}, ${pubKey1}, ${pubKey2}`,
    );

    console.log({ keys: [pubKeyRecipient, pubKey1, pubKey2] });
    // Step 3: Create a 2-of-3 multisig address using public keys
    const multisig = await client.command(
      "createMultisig",
      2,
      [pubKeyRecipient, pubKey1, pubKey2],
      //'["03789ed0bb717d88f7d321a368d905e7430207ebbd82bd342cf11ae157a7ace5fd","03dbc6764b8884a92e871274b87583e6d5c2a58819473e17e107ef3f6aa5a61626"]',
    );
    // createMultisig({
    //   nrequired: 2, // Requires 2 out of 3 signatures
    //   keys: [pubKeyRecipient, pubKey1, pubKey2], // One provided key, two generated
    // });

    console.log("Created multisig address:", multisig.address);

    // Step 4: Create a raw transaction sending BTC to the multisig address
    const rawTx = await client.createRawTransaction({
      inputs: [],
      outputs: { [multisig.address]: 0.5 }, // Sending 0.5 BTC
    });

    // Step 5: Fund the transaction (Bitcoin Core selects UTXOs)
    const fundedTx = await client.fundRawTransaction({ hexstring: rawTx });

    console.log("Funded Transaction:", fundedTx);

    // Step 6: Sign the transaction
    const signedTx = await client.signRawTransactionWithWallet({
      hexstring: fundedTx.hex,
    });

    console.log("Signed Transaction Hex:", signedTx.hex);

    // Step 7: Attempt to broadcast the transaction
    try {
      const txId = await client.sendRawTransaction({ hexstring: signedTx.hex });
      console.log("Multisig transaction sent! TXID:", txId);
    } catch (error) {
      console.error("Multisig transaction failed:", error.message);
    }
  } catch (error) {
    console.error("Error in createMultisigTransaction:", error.message);
    console.log({ error });
  }
};
const usageStr = `Usage: node script.js <command>

Available commands:
  mineTo <address>                            - Mine a block to the specified address
  mineMany <address>                          - Mine 100 blocks to the specified address
  mineToWalletAddress <nbBlocks>              - Mine specified number of blocks to a new wallet address
  sendTo <address> <amount>                   - Send a transaction to an address
  sendToMany <address> <amount> <times>       - Send multiple transactions to an address
  replaceTx <address> <amount>                - Send a transaction and replace it using RBF
  sendAutomatedRaw <address> <amount>         - Send a raw transaction, automatically funded
  sendRaw <address> <amount> [sequence]       - Send a raw transaction with a custom sequence (default: 4294967294)
  sendRawTwoOutputs <address1> <address2> <amount> [sequence] - Send a raw transaction to 2 addresses with custom sequence
  doubleSpend <address>                       - Attempt to test transaction replaceability (double-spend)
  dustTransaction <address>                   - Create a dust transaction (likely to be rejected)
  multisig <pubkey>                           - Create a 2-of-3 multisig transaction

Sequence values:
  4294967294 (0xFFFFFFFE) - Default, Locktime enabled, Non-RBF
  4294967293 (0xFFFFFFFD) - Opt-in RBF, can be replaced by higher fee transaction
  4294967295 (0xFFFFFFFF) - No locktime, no RBF`;

const main = async () => {
  const command = argv[2]; // Get command from CLI arguments
  const param1 = argv[3]; // Recipient
  const param2 = argv[4];
  const param3 = argv[5];
  const param4 = argv[6];

  console.log({ argv });
  await loadWallet("samy");
  console.log("here");
  const balance = await client.getBalance({ minconf: 0 });
  console.log({ balance });

  if (command === "sendAutomatedRaw") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error("Missing 1st param, or 2nd param not a number");
      return;
    }
    await sendAutomatedRaw(param1, parseFloat(param2));
  } else if (command === "sendRaw") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error("Missing 1st param, or 2nd param not a number");
      return;
    }
    await sendRaw(
      param1,
      parseFloat(param2),
      param3 ? parseInt(param3) : undefined,
    );
  } else if (command === "sendRawTwoOutputs") {
    if (!param1 || !param2 || isNaN(parseFloat(param3))) {
      console.error(
        "Missing 1st param, or 2nd param, or 3rd param not a number",
      );
      return;
    }
    await sendRawTwoOutputs(
      param1,
      param2,
      parseFloat(param3),
      param4 ? parseInt(param4) : undefined,
    );
  } else if (command === "mineTo") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }
    await mineTo(param1);
  } else if (command === "mineMany") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }
    await mineMany(param1);
  } else if (command === "mineToWalletAddress") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }

    await mineToWalletAddress(param1);
  } else if (command === "sendTo") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error("Missing 1st param, or 2nd param not a number");
      return;
    }
    await sendTo(param1, parseFloat(param2));
  } else if (command === "sendToMany") {
    console.log("sendtomany!!");
    if (!param1 || isNaN(parseFloat(param2)) || isNaN(parseInt(param3))) {
      console.error("Missing 1st param, or 2nd/3rd param not a number");
      return;
    }
    await sendToMany(param1, parseFloat(param2), parseInt(param3));
  } else if (command === "replaceTx") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error("Missing 1st param, or 2nd param not a number");
      return;
    }
    await sendReplaceableTransaction(param1, parseFloat(param2));
  } else if (command === "doubleSpend") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }
    await attemptDoubleSpend(param1);
  } else if (command === "dustTransaction") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }
    await createDustTransaction(param1);
  } else if (command === "multisig") {
    if (!param1) {
      console.error("Missing 1st param");
      return;
    }
    await createMultisigTransaction(param1);
  } else {
    console.log(usageStr);
  }
};

main();
