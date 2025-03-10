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

const sendAutomatedRawSequence = async function () {
  console.log("in main");
  /*
  const count = await agent.getBlockCount();
  const hash = await agent.getBlockHash(count);
  const walletInfo = await agent.getWalletInfo();
  console.log({ count, hash, walletInfo });
  const newAddress = agent.getNewAddress("-addresstype", "legacy");
  console.log({ newAddress });
  */
  const balance = await client.getBalance({
    minconf: 0,
  });
  console.log({ balance, ADDRESS_LL });

  const newAddress = await client.getNewAddress({
    address_type: "legacy",
  });
  const changeAddress = await client.getRawChangeAddress({
    address_type: "legacy",
  });
  console.log({ newAddress, changeAddress });

  const unspent = await client.listUnspent({
    query_options: { maximumCount: 1 },
  });
  if (unspent.amount < 1) {
    console.warn("pick another utxo");
    return;
  }
  console.log({ unspent });
  // createrawtransaction inputs='''[ { "txid": "'$utxo_txid'", "vout": '$utxo_vout', "sequence": 1 } ]''' outputs='''{ "'$recipient'": 0.00007658, "'$changeaddress'": 0.00000001 }''')
  //await mineBlock(newAddress);
  const recipientAmount = 1;
  const changeAmountStr = Number(
    unspent[0].amount - recipientAmount - FEES,
  ).toFixed(6);
  const changeAmount = Number(changeAmountStr);
  console.log({ changeAmount });
  if (changeAmount < 0) {
    console.warn("insufficient funds");
    return;
  }
  console.log({
    changeAmount,
    recipientAmount,
    rest: unspent[0].amount - changeAmount - recipientAmount,
  });
  const rawTxHex = await client.createRawTransaction({
    inputs: [
      {
        txid: unspent[0].txid,
        vout: unspent[0].vout,
        sequence: 4294967294,
      },
    ],
    outputs: {
      [ADDRESS_LL]: recipientAmount,
      [changeAddress]: changeAmount,
    },
  });
  console.log({ rawTxHex });

  const signedTxHex = await client.signRawTransactionWithWallet({
    hexstring: rawTxHex,
  });
  console.log({ signedTxHex });

  const txId = await client.sendRawTransaction({
    hexstring: signedTxHex.hex,
  });
  console.log({ signedTxHex, txId });

  let tx = await client.getTransaction({
    txid: txId,
    verbose: true,
  });
  console.log(JSON.stringify(tx, null, 2));
  await mineBlock(newAddress);
  sendAutomatedRaw();
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
  const param1 = argv[3];
  const param2 = argv[4];

  if (command === "sendRaw") {
    if (!param1 || isNaN(parseFloat(param2))) {
      console.error(
        "Usage: node script.js sendRaw <destinationAddress> <amount>",
      );
      return;
    }
    await sendAutomatedRaw(param1, parseFloat(param2));
  } else if (command in actions) {
    await actions[command]();
  } else {
    console.log("Usage: node script.js <command>");
    console.log("Available commands:");
    console.log("  sendRaw <address> <amount>   - Send a raw transaction");
    console.log("  doubleSpend         - Attempt a double-spend attack");
    console.log("  dustTransaction     - Create a dust transaction");
    console.log("  replaceByFee        - Test Replace-By-Fee (RBF)");
    console.log("  multisig            - Test a multisig transaction");
  }
};

main();
