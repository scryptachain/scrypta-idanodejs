import express = require("express")
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
import * as Sidechain from '../libs/Sidechain'
let CoinKey = require("coinkey")
const mongo = require('mongodb').MongoClient
const lyraInfo = {
    private: 0xae,
    public: 0x30,
    scripthash: 0x0d
}

export function issue(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  var wallet = new Crypto.Wallet;
  form.multiples = true
  form.parse(req, async function (err, fields, files) {

    if (fields.name !== undefined && fields.supply !== undefined && fields.symbol !== undefined && fields.reissuable !== undefined && fields.dapp_address !== undefined && fields.pubkey !== undefined && fields.version !== undefined && fields.private_key !== undefined && fields.decimals !== undefined) {
      let supply = parseFloat(fields.supply)
      if (supply > 0) {

        let genesis = {
          "name": fields.name,
          "supply": supply,
          "symbol": fields.symbol,
          "decimals": fields.decimals,
          "reissuable": fields.reissuable,
          "owner": fields.dapp_address,
          "pubkey": fields.pubkey,
          "version": fields.version
        }

        let sign = await wallet.signmessage(fields.private_key, JSON.stringify(genesis))
        if(sign.address === fields.dapp_address && sign.pubkey === fields.pubkey){
          let signature = sign.signature
          let sxid = sign.id
          let issue =  {
            genesis: genesis,
            signature: signature,
            sxid: sxid
          }

          var ck = new CoinKey.createRandom(lyraInfo)
          var lyraprv = ck.privateWif;
          var lyrakey = ck.publicKey.toString('hex')
          let addresses = [sign.pubkey, lyrakey]
          var txid = ''
          wallet.request('createmultisig',[addresses.length, addresses]).then(async function(init){
            var trustlink = init['result'].address
            txid = <string> await wallet.send2multisig(fields.private_key, fields.dapp_address, trustlink, 1, '', 0.001, true)

            if(txid !== null && txid.length === 64){
              
              // WRITING SIDECHAIN TO BLOCKCHAIN
              var private_keys = fields.private_key + "," + lyraprv
              var redeemScript = init['result']['redeemScript']
              var Uuid = require('uuid/v4')
              var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              var collection = '!*!'
              var refID = '!*!'
              var protocol = '!*!chain://'
              var dataToWrite = '*!*' + uuid+collection+refID+protocol+ '*=>' + JSON.stringify(issue) + '*!*'

              let write = await wallet.writemultisig(private_keys, trustlink, redeemScript, dataToWrite, uuid, collection, refID, protocol)

              // MOVE ALL FUNDS FROM SIDECHAIN ADDRESS TO OWNER ADDRESS
              var UuidTx = require('uuid/v4')
              var uuidtx = UuidTx().replace(new RegExp('-', 'g'), '.')
              
              let transaction = {}
              transaction["sidechain"] = trustlink
              transaction["inputs"] = [{sxid: sxid, vout: "genesis"}]
              transaction["outputs"] = {}
              transaction["outputs"][fields.dapp_address] = supply

              let signtx = await wallet.signmessage(fields.private_key, JSON.stringify(transaction))
              let genesistx =  {
                transaction: transaction,
                pubkey: fields.pubkey,
                signature: signtx.signature,
                sxid: signtx.id
              }
              var genesisTxToWrite = '*!*' + uuidtx+collection+refID+protocol+ '*=>' + JSON.stringify(genesistx) + '*!*'

              let sendToOwner = await wallet.writemultisig(private_keys, trustlink, redeemScript, genesisTxToWrite, uuidtx, collection, refID, protocol)

              if(sendToOwner !== false){
                res.send({
                  issue: issue,
                  funds_txid: txid,
                  sidechain: write,
                  genesis: sendToOwner,
                  issued: true
                })
              }else{
                res.send({
                  error: 'Error while sending init funds, sidechain can\'t be issued on the main chain.',
                  issued: false
                })
              }
            }else{
              console.log('Balance insufficient for airdrop, sidechain can\'t be issued on the main chain.')
              res.send({
                error: 'Balance insufficient for airdrop, sidechain can\'t be issued on the main chain.',
                issued: false
              })
            }
          })
        }else{
          res.send({
            data: {
              error: "Ownership not confirmed, calculated pubkey or address are not valid."
            },
            status: 422
          })
        }

      } else {
        res.send({
          data: {
            error: "Supply must be grater than 0."
          },
          status: 422
        })
      }

    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
        },
        status: 422
      })
    }
  })
};

export function send(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  var wallet = new Crypto.Wallet;
  form.multiples = true
  form.parse(req, async function (err, fields, files) {

    if(fields.from !== undefined && fields.sidechain_address !== undefined && fields.to !== undefined && fields.amount !== undefined && fields.private_key !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({address: fields.sidechain_address}).sort({block: 1}).limit(1).toArray()
        let decimals = parseInt(check_sidechain[0].data.genesis.decimals)
        let checkto = await wallet.request('validateaddress', [fields.to])

        if(checkto['result'].isvalid === true){
          if(check_sidechain[0] !== undefined && check_sidechain[0].address === fields.sidechain_address){
            var scwallet = new Sidechain.Wallet;
            let unspent = await scwallet.listunpent(fields.from, fields.sidechain_address)
            let inputs = []
            let outputs = {}
            let amountinput = 0
            let amount = parseFloat(parseFloat(fields.amount).toFixed(decimals))
            
            for(let i in unspent){
              if(amountinput < amount){
                delete unspent[i]._id
                let checkinput = await db.collection('sc_transactions').find({sxid: unspent[i].sxid}).limit(1).toArray()
                if(checkinput[0] !== undefined){
                  let checksig = await wallet.signmessage(fields.private_key, JSON.stringify(checkinput[0].transaction))
                  if(checksig.signature === checkinput[0].signature && checksig.id === checkinput[0].sxid){
                    inputs.push(unspent[i])
                    amountinput += unspent[i].amount
                  }
                }
              }
            }

            if(amountinput >= fields.amount){

              let change = amountinput - amount
              outputs[fields.to] = amount
              if(change > 0){
                outputs[fields.from] = change
              }

              let transaction = {}
              transaction["sidechain"] = fields.sidechain_address
              transaction["inputs"] = inputs
              transaction["outputs"] = outputs
              let signtx = await wallet.signmessage(fields.private_key, JSON.stringify(transaction))

              let tx = {
                transaction: transaction,
                signature: signtx.signature,
                pubkey: fields.pubkey,
                sxid: signtx.id
              }
              var Uuid = require('uuid/v4')
              var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              var collection = '!*!'
              var refID = '!*!'
              var protocol = '!*!chain://'
              var dataToWrite = '*!*' + uuid+collection+refID+protocol+ '*=>' + JSON.stringify(tx) + '*!*'

              let write = await wallet.write(fields.private_key,fields.from,dataToWrite,uuid,collection,refID,protocol)
              if(write !== false){
                res.send(write)
              }else{
                res.send({
                  error: true,
                  description: "Can\'t send transaction",
                  status: 422
                })
              }

            }else{
              res.send({
                error: true,
                description: "Insufficient balance",
                status: 422
              })
            }
          }else{
            res.send({
              data: {
                error: "Receiving address is invalid."
              },
              status: 422
            })
          }
        }else{
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    }else{
      res.send({
        data: {
          error: "Specify all required fields first."
        },
        status: 422
      })
    }
  })
  /*
    To send the funds you've to use a similar approach to the normal transactions, for simplicity let's assume this is the very first transaction of the SideChain. The owner will move these tokens from his account to another account. 

    So it have to write a TX that's something like this:
    {
      "transaction":
      {
        "inputs": [
          "signatureOfTheInput": "VoutOfTheInput"
        ],
        "outputs": {
          "receiverAddress": amount,
          "senderAddress": change
        }
      },
      "pubkey": "SenderPubKey",
      "id": "SHA256(SignatureOfTheTransactionByTheOwner)"
    }

    This will create a transaction that's pretty similar to the legacy one. This transaction it's verified first by the IdaNode which will check that the output is <= inputs and both the receiver and the sender are valid. After it is verified it will be marked by the IdaNode with another security hash and then written on the blockchain. To speed up all the process we can even sent it to the P2P network just to create a "unconfirmed" style feature.

    When both the accounts will receive the information (by reading the IdaNode) they will check the signatures and, again, the inputs and the outputs. Just to minimize the risk of hacking of the entire system by malicious Idanodes or malicious clients.
  */
};

export function reissue(req: express.Request, res: express.Response) {
  /*
    This will write a transaction inside the SideChain adding in effect balance to the owner, only if in the genesis transaction the token have been flagged as "reissuable"
  */
};

export function balance(req: express.Request, res: express.Response) {
  /*
    To calculate the balance the node will in effect validate all the transactions, validating every single input and every single output.
    The sum will give us the balance of the user. Maybe this operation must be written inside the database to increase performance, but let assume it's fast enough. Maybe all the previous checks will in effect write only the valid transactions into the database.
    Everytime a transaction is invalid it should be deleted by the IdaNode.
  */
};

export function verify(req: express.Request, res: express.Response) {
  /*
    With this operation the IdaNode will check every side-transaction written on the blockchain, preventing to malicious, malformed or invalid transactions that will eventually pass the validation to be written on the main database. This is a secondary verification feature because, in effect, every client will check his own transactions and, if there's something strange, the transaction will be rejected by the client which in effect rejects the payment. The verification will be recursive so every new block if there's one or more sidechain transaction the Idanode will check the previous tx and write it into the database if it's valid. A full rescan can be performed to make sure that's all working but, again, if one hash is not working it will never be written so it's unspendable (even if it's written in the blockchain).
  */
};