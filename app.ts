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

const sendToAddress = async (newAddress: string) => {
  const txSendToAddress = await client.sendToAddress({
    address: ADDRESS_LL,
    amount: 1,
  });

  let tx = await client.getTransaction({
    txid: txSendToAddress,
    verbose: true,
  });

  // let rawTx = await client.getRawTransaction({
  //   txid: txSendToAddress,
  // });

  console.log({ txSendToAddress, tx, vin: tx.decoded.vin });

  await mineBlock(newAddress);

  tx = await client.getTransaction({
    txid: txSendToAddress,
    verbose: true,
  });
  // rawTx = await client.getRawTransaction({
  //   txid: txSendToAddress,
  // });

  // const txNow = await jq.run(".", tx, { input: "json" });
  console.log({ tx, vin: tx.decoded.vin });

  // const balance = await client.command("-named", "getbalance", {
  //   account: "*",
  //   minconf: 0,
  // });
  // console.log({ balance });
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
  } else if (command in actions) {
    await actions[command]();
  } else {
    console.log("Usage: node script.js <command>");
    console.log("Available commands:");
    console.log("  sendRaw <address> <amount>   - Send a raw transaction");
    console.log(
      "  sendRawSequence <address> <amount> [sequence] - Send a raw transaction with a custom sequence",
    );
    console.log("  doubleSpend         - Attempt a double-spend attack");
    console.log("  dustTransaction     - Create a dust transaction");
    console.log("  replaceByFee        - Test Replace-By-Fee (RBF)");
    console.log("  multisig            - Test a multisig transaction");
  }
};

main();
