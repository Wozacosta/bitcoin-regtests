import RpcAgent from "bcrpc";
import Client from "bitcoin-core";
// const jq = require('node-jq')
import * as jq from "node-jq";
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
const ADDRESS_LL = "bcrt1qa45rpfk2af2kuth6zfydnqmw7aygkqvmfj25da";
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

const sendAutomatedRaw = async () => {
  const unfinishedTx = await client.createRawTransaction({
    inputs: [],
    outputs: {
      [ADDRESS_LL]: 10,
    },
  });

  // https://developer.bitcoin.org/reference/rpc/fundrawtransaction.html
  const fundedTx = await client.fundRawTransaction({
    hexstring: unfinishedTx,
    options: {
      replaceable: false,
    },
  });

  const decodedTx = await client.decodeRawTransaction({
    hexstring: fundedTx.hex,
  });

  console.log({ unfinishedTx, fundedTx });
  console.log(JSON.stringify(decodedTx, null, 2));

  const signedTxHex = await client.signRawTransactionWithWallet({
    hexstring: fundedTx.hex,
  });
  console.log({ signedTxHex });

  const transactionId = await client.sendRawTransaction({
    hexstring: signedTxHex.hex,
  });
  console.log({ signedTxHex, transactionId });
};

const main = async function () {
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

main();
