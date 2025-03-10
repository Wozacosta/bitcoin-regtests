import RpcAgent from "bcrpc";
import Client from "bitcoin-core";
// const jq = require('node-jq')
import * as jq from "node-jq";
import { argv } from "process";
console.log({ jq });

//console.log("toto");
// fetched from bitcoin.conf
const agent = new RpcAgent({
  host: "localhost",
  port: 18443,
  user: "admin1",
  pass: "123",
});
console.log({ agent });
const client: any = new Client({
  version: "0.24.1",
  // host: "localhost:18443",
  username: "admin1",
  password: "123",
  host: "http://localhost:18443",
});
// console.log({ client });
//
//
const ADDRESS_LL = "mpW6aGSV88B9HUjPDTNnnYMRCLkaSqqvyx";
const FEES = 0.0001;

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

const sendToAddress = async (recipientAddress, amount) => {
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
      options: { replaceable: false }, // Set to true if RBF is needed
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

const sendAutomatedRawSequence = async (
  recipientAddress,
  amount,
  sequence = 4294967294,
) => {
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
    // Step 1: Check balance
    const balance = await client.getBalance({ minconf: 0 });
    console.log({ balance, ADDRESS_LL });

    // Step 2: Get new addresses
    const newAddress = await client.getNewAddress({ address_type: "legacy" });
    const changeAddress = await client.getRawChangeAddress({
      address_type: "legacy",
    });
    console.log({ newAddress, changeAddress });

    // Step 3: Get UTXO for spending
    const unspent = await client.listUnspent({
      query_options: { maximumCount: 1 },
    });

    if (unspent.length === 0 || unspent[0].amount < amount) {
      console.warn("Insufficient funds. Pick another UTXO.");
      return;
    }

    console.log({ unspent });

    // Step 4: Calculate change
    const changeAmountStr = Number(unspent[0].amount - amount - FEES).toFixed(
      6,
    );
    const changeAmount = Number(changeAmountStr);

    if (changeAmount < 0) {
      console.warn("Insufficient funds after fees.");
      return;
    }

    console.log({
      changeAmount,
      recipientAmount: amount,
      remainingBalance: unspent[0].amount - changeAmount - amount,
    });

    // Step 5: Create raw transaction
    const rawTxHex = await client.createRawTransaction({
      inputs: [
        {
          txid: unspent[0].txid,
          vout: unspent[0].vout,
          sequence: sequence,
        },
      ],
      outputs: {
        [recipientAddress]: amount,
        [changeAddress]: changeAmount,
      },
    });

    console.log("Raw Transaction Hex:", rawTxHex);

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
    console.error("Error in sendAutomatedRawSequence:", error.message);
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

const createMultisigTransaction = async (recipientAddress) => {
  if (!recipientAddress) {
    console.error("Invalid parameter: Provide a valid recipient address.");
    return;
  }

  console.log(`Creating a multisig transaction to ${recipientAddress}...`);

  try {
    // Step 1: Generate additional addresses for the multisig wallet
    const key1 = await client.getNewAddress({ address_type: "legacy" });
    const key2 = await client.getNewAddress({ address_type: "legacy" });

    console.log(`Generated additional multisig keys: ${key1}, ${key2}`);

    // Step 2: Create a 2-of-3 multisig address
    // https://developer.bitcoin.org/reference/rpc/addmultisigaddress.html#argument-4-address-type
    const multisig = await client.addMultiSigAddress({
      nrequired: 2, // Requires 2 out of 3 signatures
      keys: [recipientAddress, key1, key2], // One provided address, two generated
    });

    console.log("Created multisig address:", multisig.address);

    // Step 3: Create a raw transaction sending BTC to the multisig address
    const rawTx = await client.createRawTransaction({
      inputs: [],
      outputs: { [multisig.address]: 0.5 }, // Sending 0.5 BTC
    });

    // Step 4: Fund the transaction (Bitcoin Core selects UTXOs)
    const fundedTx = await client.fundRawTransaction({ hexstring: rawTx });

    console.log("Funded Transaction:", fundedTx);

    // Step 5: Sign the transaction
    const signedTx = await client.signRawTransactionWithWallet({
      hexstring: fundedTx.hex,
    });

    console.log("Signed Transaction Hex:", signedTx.hex);

    // Step 6: Attempt to broadcast the transaction
    try {
      const txId = await client.sendRawTransaction({ hexstring: signedTx.hex });
      console.log("Multisig transaction sent! TXID:", txId);
    } catch (error) {
      console.error("Multisig transaction failed:", error.message);
    }
  } catch (error) {
    console.error("Error in createMultisigTransaction:", error.message);
    console.error({ error });
  }
};

// Function mapping for CLI
const actions = {
  // sendRaw: sendAutomatedRaw,
  sendAutomatedRawSequence,
  // doubleSpend: attemptDoubleSpend,
  // dustTransaction: createDustTransaction,
  // replaceByFee: replaceByFeeTransaction,
  // multisig: createMultisigTransaction,
};

const main = async () => {
  const command = argv[2]; // Get command from CLI arguments
  const param1 = argv[3]; // Recipient
  const param2 = argv[4]; // Amount
  const param3 = argv[5]; // Sequence (optional)

  if (command === "sendRaw") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error(
        "Usage: node script.js sendRaw <destinationAddress> <amount>",
      );
      return;
    }
    await sendAutomatedRaw(param1, parseFloat(param2));
  } else if (command === "sendRawSequence") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error(
        "Usage: node script.js sendRawSequence <recipientAddress> <amount> [sequence]",
      );
      return;
    }
    await sendAutomatedRawSequence(
      param1,
      parseFloat(param2),
      param3 ? parseInt(param3) : undefined,
    );
  } else if (command === "mineTo") {
    if (!param1) {
      console.error("Usage: node script.js mineTo <recipientAddress>");
      return;
    }
    await mineTo(param1);
  } else if (command === "sendTo") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error("Usage: node script.js sendTo <recipientAddress> <amount>");
      return;
    }
    await sendToAddress(param1, parseFloat(param2));
  } else if (command === "doubleSpend") {
    if (!param1) {
      console.error("Usage: node script.js doubleSpend <recipientAddress>");
      return;
    }
    await attemptDoubleSpend(param1);
  } else if (command === "dustTransaction") {
    if (!param1) {
      console.error("Usage: node script.js dustTransaction <recipientAddress>");
      return;
    }
    await createDustTransaction(param1);
  } else if (command === "multisig") {
    if (!param1) {
      console.error("Usage: node script.js multisig <recipientAddress>");
      return;
    }
    await createMultisigTransaction(param1);
  } else if (command in actions) {
    await actions[command]();
  } else {
    console.log("Usage: node script.js <command>");
    console.log("Available commands:");
    console.log("  mineTo <address>        - Mine a block to the address");
    console.log(
      "  sendTo <address> <amount>     - Send a transaction to an address",
    );
    console.log("  sendRaw <address> <amount>   - Send a raw transaction");
    console.log(
      "  sendRawSequence <address> <amount> [sequence] - Send a raw transaction with a custom sequence",
    );
    console.log(
      "  doubleSpend <address>        - Attempt a double-spend attack",
    );
    console.log("  dustTransaction <address>    - Create a dust transaction");
    console.log("  multisig <address>           - Test a multisig transaction");
    console.log("  replaceByFee        - Test Replace-By-Fee (RBF)");
  }
};

main();
