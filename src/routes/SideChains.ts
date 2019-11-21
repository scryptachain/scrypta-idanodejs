import express = require("express")
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
let CoinKey = require("coinkey")
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

    if (fields.name !== undefined && fields.supply !== undefined && fields.symbol !== undefined && fields.reissuable !== undefined && fields.dapp_address !== undefined && fields.pubkey !== undefined && fields.version !== undefined && fields.private_key !== undefined) {
      let supply = parseFloat(fields.supply)
      if (supply > 0) {

        let genesis = {
          "name": fields.name,
          "supply": supply,
          "symbol": fields.symbol,
          "reissuable": fields.reissuable,
          "owner": fields.dapp_address,
          "pubkey": fields.pubkey,
          "version": fields.version
        }

        let sign = await wallet.signmessage(fields.private_key, JSON.stringify(genesis))
        if(sign.address === fields.dapp_address && sign.pubkey === fields.pubkey){
          let signature = sign.signature
          let id = sign.id
          let issue =  {
            genesis: genesis,
            signature: signature,
            id: id
          }

          var ck = new CoinKey.createRandom(lyraInfo)
          var lyrapub = ck.publicAddress;
          var lyraprv = ck.privateWif;
          var lyrakey = ck.publicKey.toString('hex')
          // WARNING!! FOR TEST ONLY
          lyrapub = "LMwgDcs9XK6yP54uBRLwdw8Nu1d8WJZzrG"
          lyraprv = "Skr7ocYWN4A6VK37WrKBgdM8eZNRpyMLKZM942mV7PSoeHZu4SZ9"
          lyrakey = "0399c0cc5c62f84959854e0f571e9929249282d56f22559f5947e30eeee087ebb4"
          let addresses = [sign.pubkey, lyrakey]
          var txid = ''
          wallet.request('createmultisig',[addresses.length, addresses]).then(async function(init){
            var trustlink = init['result'].address
            txid = <string> await wallet.send2multisig(fields.private_key, fields.dapp_address, trustlink, 0.01, '', 0.001, true)

            if(txid !== null && txid.length === 64){
              
              var private_keys = fields.private_key + "," + lyraprv
              var redeemScript = init['result']['redeemScript']
              var Uuid = require('uuid/v4')
              var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              var collection = '!*!'
              var refID = '!*!'
              var protocol = '!*!chain://'
              var dataToWrite = '*!*' + uuid+collection+refID+protocol+ '*=>' + JSON.stringify(issue) + '*!*'

              var txs = []
                  var dataToWriteLength = dataToWrite.length
                  var nchunks = Math.ceil(dataToWriteLength / 74)
                  var last = nchunks - 1
                  var chunks = []

                  for (var i=0; i<nchunks; i++){
                      var start = i * 74
                      var end = start + 74
                      var chunk = dataToWrite.substring(start,end)

                      if(i === 0){
                          var startnext = (i + 1) * 74
                          var endnext = startnext + 74
                          var prevref = ''
                          var nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                      } else if(i === last){
                          var startprev = (i - 1) * 74
                          var endprev = startprev + 74
                          var nextref = ''
                          var prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                      } else {
                          var sni = i + 1
                          var startnext = sni * 74
                          var endnext = startnext + 74
                          var nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                          var spi = i - 1
                          var startprev = spi * 74
                          var endprev = startprev + 74
                          var prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                      }
                      chunk = prevref + chunk + nextref
                      chunks.push(chunk)
                  }

                  var totalfees = 0
                  var error = false
                  var decoded

                  for(var cix=0; cix<chunks.length; cix++){
                      var txid = ''
                      var i = 0
                      while(txid !== null && txid !== undefined && txid.length !== 64){
                          var fees = 0.001 + (i / 1000)

                          txid = <string> await wallet.sendmultisig(private_keys,trustlink,trustlink,0,chunks[cix],redeemScript,fees,true)
                          if(txid !== null && txid.length === 64){
                              console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                              totalfees += fees
                              txs.push(txid)
                          }else{
                            console.log('TX FAILED.')
                          }

                          i++;
                          if(i > 20){
                              error = true
                              txid = '0000000000000000000000000000000000000000000000000000000000000000'
                          }
                      }
                  }
              if(error === false){
                res.send({
                  token: issue,
                  funds_txid: txid,
                  sidechain: {
                    uuid: uuid,
                    address: trustlink,
                    fees: totalfees,
                    collection: collection.replace('!*!',''),
                    refID: refID.replace('!*!',''),
                    protocol: protocol.replace('!*!',''),
                    dimension: dataToWrite.length,
                    chunks: nchunks,
                    stored: dataToWrite,
                    txs: txs
                  },
                  issued: true
                })
              }else{

              }
            }else{
              console.log('Balance insufficient for airdrop, token can\'t be issued on the chain.')
              res.send({
                token: issue,
                funds_txid: txid,
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

    /*
      Defining sidechain protocol:

      User want to create a sidechain, the IdaNode will create a new address and merges that address with the user's one to create a Trustlink.
      The IdaNode's address it's destroyed after the first operation and it's not stored inside the IdaNode. 
      The SideChain must start with at least 5 LYRA inside to write all the first informations.
      These LYRA in effect will be burned if no-one store the second address.
      
      First operation is just about the issuing of the token, which have to contain these informations:
      {
        "genesis": {
          "name": "MYTOKEN",
          "symbol": "MTT",
          "supply": 1000,
          "reissuable": true,
          "owner": "MyAddress",
          "pubkey": "OwnerPubKey"
          "version": 1
        },
        "signature": "SignatureOfTheGenesisByOwner"
        "id": "SHA256(SignatureOfTheGenesisByOwner)"
      }
      
      After writing this informations the IdaNode will read all the information inside the block and will create the first sub-block of information, with the genesis and the signature, which will act as TXID in normal transactions. Because all the operations will require more than 1 writing i think it's better to create something parallel. 

      The user can now spend these Tokens by invoking the other endpoint.
    */
  })
};

export function send(req: express.Request, res: express.Response) {
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