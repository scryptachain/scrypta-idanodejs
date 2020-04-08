import express = require("express")
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
import * as Sidechain from '../libs/Sidechain'
let CoinKey = require("coinkey")
const mongo = require('mongodb').MongoClient
import * as Utilities from '../libs/Utilities'
import { Z_MEM_ERROR } from "zlib"
import Daemon = require("../libs/Daemon")

export async function issue(req: express.Request, res: express.Response) {
  var wallet = new Crypto.Wallet;
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.name !== undefined && fields.burnable !== undefined && fields.supply !== undefined && fields.symbol !== undefined && fields.reissuable !== undefined && fields.dapp_address !== undefined && fields.pubkey !== undefined && fields.version !== undefined && fields.private_key !== undefined && fields.decimals !== undefined) {
      let supply = parseFloat(fields.supply)
      if (supply > 0) {
        
        var burnable = true
        if(fields.burnable === 'false' || fields.burnable === false){
          burnable = false
        }

        var reissuable = true
        if(fields.reissuable === 'false' || fields.reissuable === false){
          reissuable = false
        }

        var dna = ''
        if(fields.dna !== undefined && fields.dna !== ''){
          dna = fields.dna
        }

        let genesis = {
          "name": fields.name,
          "supply": supply,
          "symbol": fields.symbol,
          "decimals": fields.decimals,
          "reissuable": reissuable,
          "owner": fields.dapp_address,
          "pubkey": fields.pubkey,
          "burnable": burnable,
          "version": fields.version,
          "dna": dna,
          "time": new Date().getTime()
        }

        let sign = await wallet.signmessage(fields.private_key, JSON.stringify(genesis))
        if (sign.address === fields.dapp_address && sign.pubkey === fields.pubkey) {
          let signature = sign.signature
          let sxid = sign.id
          let issue = {
            genesis: genesis,
            signature: signature,
            pubkey: sign.pubkey,
            sxid: sxid
          }

          var ck = new CoinKey.createRandom(global['lyraInfo'])
          var lyraprv = ck.privateWif;
          var lyrakey = ck.publicKey.toString('hex')
          let addresses = [sign.pubkey, lyrakey]
          var txid = ''
          wallet.request('createmultisig', [addresses.length, addresses]).then(async function (init) {
            var trustlink = init['result'].address
            txid = <string>await wallet.send2multisig(fields.private_key, fields.dapp_address, trustlink, 1, '', 0.001, true)

            if (txid !== null && txid.length === 64) {

              // WRITING SIDECHAIN TO BLOCKCHAIN
              var private_keys = fields.private_key + "," + lyraprv
              var redeemScript = init['result']['redeemScript']
              var Uuid = require('uuid/v4')
              var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              var collection = '!*!'
              var refID = '!*!'
              var protocol = '!*!chain://'
              var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(issue) + '*!*'

              let write = await wallet.writemultisig(private_keys, trustlink, redeemScript, dataToWrite, uuid, collection, refID, protocol)

              // MOVE ALL FUNDS FROM SIDECHAIN ADDRESS TO OWNER ADDRESS
              var UuidTx = require('uuid/v4')
              var uuidtx = UuidTx().replace(new RegExp('-', 'g'), '.')

              let transaction = {}
              transaction["sidechain"] = trustlink
              transaction["inputs"] = [{ sxid: sxid, vout: "genesis" }]
              transaction["outputs"] = {}
              transaction["outputs"][fields.dapp_address] = supply
              transaction["time"] = new Date().getTime()

              let signtx = await wallet.signmessage(fields.private_key, JSON.stringify(transaction))
              let genesistx = {
                transaction: transaction,
                pubkey: fields.pubkey,
                signature: signtx.signature,
                sxid: signtx.id
              }
              var genesisTxToWrite = '*!*' + uuidtx + collection + refID + protocol + '*=>' + JSON.stringify(genesistx) + '*!*'

              let sendToOwner = await wallet.writemultisig(private_keys, trustlink, redeemScript, genesisTxToWrite, uuidtx, collection, refID, protocol)

              if (sendToOwner !== false) {
                res.send({
                  issue: issue,
                  funds_txid: txid,
                  sidechain: write,
                  genesis: sendToOwner,
                  issued: true
                })
              } else {
                res.send({
                  error: 'Error while sending init funds, sidechain can\'t be issued on the main chain.',
                  issued: false
                })
              }
            } else {
              console.log('Balance insufficient for airdrop, sidechain can\'t be issued on the main chain.')
              res.send({
                error: 'Balance insufficient for airdrop, sidechain can\'t be issued on the main chain.',
                issued: false
              })
            }
          })
        } else {
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
  } else {
    res.send({
      data: {
        error: "Specify all required fields first."
      },
      status: 422
    })
  }
};

export async function send(req: express.Request, res: express.Response) {
  var wallet = new Crypto.Wallet;
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.from !== undefined && fields.sidechain_address !== undefined && fields.to !== undefined && fields.amount !== undefined && fields.private_key !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        let decimals = parseInt(check_sidechain[0].data.genesis.decimals)
        let checkto = await wallet.request('validateaddress', [fields.to])

        if (checkto['result'].isvalid === true) {
          if (check_sidechain[0] !== undefined && check_sidechain[0].address === fields.sidechain_address) {
            var scwallet = new Sidechain.Wallet;
            let unspent = await scwallet.listunspent(fields.from, fields.sidechain_address)
            let inputs = []
            let outputs = {}
            let amountinput = 0
            let amount = parseFloat(parseFloat(fields.amount).toFixed(decimals))
            let usedtx = []
            for (let i in unspent) {
              if (amountinput < amount) {
                delete unspent[i]._id
                delete unspent[i].sidechain
                delete unspent[i].address
                let checkinput = await db.collection('sc_transactions').find({ sxid: unspent[i].sxid }).limit(1).toArray()
                if (checkinput[0] !== undefined && checkinput[0].transaction.outputs[fields.from] !== undefined && checkinput[0].transaction.outputs[fields.from] === unspent[i].amount) {
                  if (global['sxidcache'].indexOf(unspent[i].sxid) === -1) {
                    delete unspent[i].block
                    let validateinput = await scwallet.validateinput(unspent[i].sxid, unspent[i].vout, fields.sidechain_address, fields.from)
                    if(validateinput === true){
                      inputs.push(unspent[i])
                      usedtx.push(unspent[i].sxid)
                      amountinput += parseFloat(unspent[i].amount.toFixed(check_sidechain[0].data.genesis.decimals))
                    }else{
                      await db.collection('sc_unspent').deleteOne({"_id": unspent[i]._id})
                    }
                  }
                }
              }
            }
            let totaloutputs = 0
            amountinput = parseFloat(amountinput.toFixed(check_sidechain[0].data.genesis.decimals))
            amount = parseFloat(amount.toFixed(check_sidechain[0].data.genesis.decimals))
            if (amountinput >= fields.amount) {
              
              if(fields.to === check_sidechain[0].address && check_sidechain[0].data.burnable === false){
                
                res.send({
                  error: true,
                  description: "Can\'t burn asset.",
                  status: 422
                })

              }else{

                outputs[fields.to] = amount
                totaloutputs += amount

                let change = amountinput - amount
                change = parseFloat(change.toFixed(check_sidechain[0].data.genesis.decimals))

                if(fields.to !== fields.from){
                  if (change > 0) {
                    outputs[fields.from] = change
                    totaloutputs += change
                  }
                }else{
                  if (change > 0) {
                    outputs[fields.from] = change + amount
                    totaloutputs += change
                  }
                }

                totaloutputs = parseFloat(totaloutputs.toFixed(check_sidechain[0].data.genesis.decimals))
                if (inputs.length > 0 && totaloutputs > 0) {
                  let transaction = {}
                  transaction["sidechain"] = fields.sidechain_address
                  transaction["inputs"] = inputs
                  transaction["outputs"] = outputs
                  let memo = ''
                  if(fields.memo !== undefined){
                    memo = fields.memo
                  }
                  transaction["memo"] = memo
                  transaction["time"] = new Date().getTime()

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
                  var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(tx) + '*!*'

                  let write = await wallet.write(fields.private_key, fields.from, dataToWrite, uuid, collection, refID, protocol)
                  if (write !== false) {
                    res.send(write)
                    for (let x in usedtx) {
                      global['sxidcache'].push(usedtx[x])
                    }
                    let vout = 0
                    for (let x in outputs) {
                      let unspent = {
                        sxid: tx.sxid,
                        vout: vout,
                        address: x,
                        amount: outputs[x],
                        sidechain: tx.transaction['sidechain']
                      }
                      global['usxocache'].push(unspent)
                      vout++
                    }
                    
                  } else {
                    res.send({
                      error: true,
                      description: "Error creating transaction",
                      status: 422
                    })
                  }
                } else {
                  res.send({
                    error: true,
                    description: "Can\'t send transaction",
                    status: 422
                  })
                }
              }
            } else {
              res.send({
                error: true,
                description: "Insufficient balance",
                status: 422
              })
            }
          } else {
            res.send({
              data: {
                error: "Receiving address is invalid."
              },
              status: 422
            })
          }
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
};

export async function reissue(req: express.Request, res: express.Response) {
 var parser = new Utilities.Parser
 var wallet = new Crypto.Wallet
 var request = await parser.body(req)
 if (request !== false) {
   let fields = request['body']
   if (fields.dapp_address !== undefined && fields.pubkey !== undefined && fields.sidechain_address !== undefined && fields.supply !== undefined && fields.private_key !== undefined) {
     mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
       const db = client.db(global['db_name'])

       let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
       if (check_sidechain[0] !== undefined) { 
        if(check_sidechain[0].data.genesis.reissuable === true){      
          let supply = parseFloat(fields.supply)
          if(supply > 0){
            
            let reissue = {
              "sidechain": fields.sidechain_address,
              "owner": fields.dapp_address,
              "supply": supply,
              "time": new Date().getTime()
            }

            let sign = await wallet.signmessage(fields.private_key, JSON.stringify(reissue))
            if (sign.address === fields.dapp_address && sign.pubkey === fields.pubkey && sign.address === check_sidechain[0].data.genesis.owner) {
              let signature = sign.signature
              let sxid = sign.id
              let signed = {
                reissue: reissue,
                signature: signature,
                pubkey: sign.pubkey,
                sxid: sxid
              }

              // WRITE REISSUE
              var Uuid = require('uuid/v4')
              var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              var collection = '!*!'
              var refID = '!*!'
              var protocol = '!*!chain://'
              var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(signed) + '*!*'
              let write = await wallet.write(fields.private_key, fields.dapp_address, dataToWrite, uuid, collection, refID, protocol)

              // CREATE REISSUE UNSPENT
              var UuidTx = require('uuid/v4')
              var uuidtx = UuidTx().replace(new RegExp('-', 'g'), '.')

              let transaction = {}
              transaction["sidechain"] = fields.sidechain_address
              transaction["inputs"] = [{ sxid: sxid, vout: "reissue" }]
              transaction["outputs"] = {}
              transaction["outputs"][fields.dapp_address] = supply
              transaction["time"] = new Date().getTime()

              let signtx = await wallet.signmessage(fields.private_key, JSON.stringify(transaction))
              let reissuetx = {
                transaction: transaction,
                pubkey: fields.pubkey,
                signature: signtx.signature,
                sxid: signtx.id
              }
              var reissuetxTxToWrite = '*!*' + uuidtx + collection + refID + protocol + '*=>' + JSON.stringify(reissuetx) + '*!*'
              let unspent = await wallet.write(fields.private_key, fields.dapp_address, reissuetxTxToWrite, uuid, collection, refID, protocol)

              res.send({
                reissue: signed,
                written: write,
                unspent: unspent,
                status: 200
              })
            }else{
              res.send({
                error: 'Sign don\'t match',
                status: 402
              })
            }
          }else{
            res.send({
              data: {
                error: "Supply must be greater than 0."
              },
              status: 422
            })
          }
        }else{
          res.send({
            data: {
              error: "Sidechain not reissuable."
            },
            status: 422
          })
        }
       } else {
         res.send({
           data: {
             error: "Sidechain not found."
           },
           status: 422
         })
       }
     })
   } else {
     res.send({
       data: {
         error: "Specify all required fields first."
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
};

export async function getsidechain(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunspent(fields.dapp_address, fields.sidechain_address)
        if (check_sidechain[0] !== undefined) {
          res.json({
            sidechain: check_sidechain
          })
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
};

export async function balance(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.dapp_address !== undefined && fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunspent(fields.dapp_address, fields.sidechain_address)
        if (check_sidechain[0] !== undefined) {
          let balance = 0
          for (let x in unspent) {
            balance += parseFloat(unspent[x].amount.toFixed(check_sidechain[0].data.genesis.decimals))
          }

          res.json({
            balance: parseFloat(balance.toFixed(check_sidechain[0].data.genesis.decimals)),
            symbol: check_sidechain[0].data.genesis.symbol,
            sidechain: check_sidechain[0].address
          })
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
};

export async function transactions(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    var wallet = new Crypto.Wallet;
    if (fields.dapp_address !== undefined && fields.sidechain_address) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        if (check_sidechain[0] !== undefined) {
          let transactions = []
          let unconfirmed = []

          let txs = await db.collection('sc_transactions').find({ "transaction.sidechain": fields.sidechain_address }).sort({ block: -1 }).toArray()
          for (let tx in txs) {
            let from = await wallet.getAddressFromPubKey(txs[tx].pubkey)
            if (from === fields.dapp_address || txs[tx].transaction.outputs[fields.dapp_address] !== undefined) {
              delete txs[tx]._id
              var isGenesis = false
              var isReissue = false
              for(let x in txs[tx].transaction.inputs){
                if(txs[tx].transaction.inputs[x].vout === 'genesis'){
                  isGenesis = true
                  from = "GENESIS"
                }else if(txs[tx].transaction.inputs[x].vout === 'reissue'){
                  isReissue = true
                  from = "REISSUE"
                }
              }
              let to
              let amount

              if(!isGenesis && !isReissue){
                for(let y in txs[tx].transaction.outputs){
                  if (y !== from) {
                    amount = txs[tx].transaction.outputs[y]
                  }
                }
                
                for (let address in txs[tx].transaction.outputs) {
                  if (address !== from) {
                    to = address
                  }
                }

                if(to !== fields.dapp_address){
                  amount = amount * -1
                }
                if(to === undefined){
                  to = from
                  amount = txs[tx].transaction.outputs[to]
                }
              }else{
                to = await wallet.getAddressFromPubKey(txs[tx].pubkey)
                amount = txs[tx].transaction.outputs[to]
              }
              let memo = ''
              if(txs[tx].transaction.memo !== undefined){
                memo = txs[tx].transaction.memo
              }
              let analyzed = {
                sxid: txs[tx].sxid,
                from: from,
                to: to,
                amount: parseFloat(amount.toFixed(check_sidechain[0].data.genesis.decimals)),
                memo: memo,
                time: txs[tx].transaction.time,
                block: txs[tx].block
              }

              if(txs[tx].block !== null){
                transactions.push(analyzed)
              }else{
                unconfirmed.push(analyzed)
              }
            }
          }
          
          let response_txs = []
          for(let x in unconfirmed){
            response_txs.push(unconfirmed[x])
          }
          for(let y in transactions){
            response_txs.push(transactions[y])
          }

          res.json({
            transactions: response_txs,
            symbol: check_sidechain[0].data.genesis.symbol,
            sidechain: check_sidechain[0].address
          })
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
};

export async function listunspent(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.dapp_address !== undefined && fields.sidechain_address) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunspent(fields.dapp_address, fields.sidechain_address)
        if (check_sidechain[0] !== undefined) {
          res.json({
            unspent: unspent,
            sidechain: check_sidechain[0].address
          })
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
}

export async function scanaddress(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.dapp_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        var scwallet = new Sidechain.Wallet;
        let sidechain_datas = await db.collection('written').find({ protocol: 'chain://' }).sort({ block: 1 }).toArray()
        if (sidechain_datas[0] !== undefined) {
          let sidechains = []
          let addresses_sidechains = []
          let scan = []
          for (let x in sidechain_datas) {
            if (sidechain_datas[x].data.genesis !== undefined && sidechain_datas[x].data.genesis.time !== undefined && addresses_sidechains.indexOf(sidechain_datas[x].address) === -1) {
              addresses_sidechains.push(sidechain_datas[x].address)
              sidechain_datas[x].data.address = sidechain_datas[x].address
              sidechains.push(sidechain_datas[x].data)
            }
          }
          for (let y in sidechains) {
            let balance = 0
            let unspent = await scwallet.listunspent(fields.dapp_address, sidechains[y].address)
            if (unspent.length > 0) {
              for (let z in unspent) {
                balance += parseFloat(unspent[z].amount.toFixed(sidechains[y].genesis.decimals))
              }
            }
            if (balance > 0) {
              scan.push({
                sidechain: sidechains[y].address,
                symbol: sidechains[y].genesis.symbol,
                balance: parseFloat(balance.toFixed(sidechains[y].genesis.decimals))
              })
            }
          }
          res.send({
            data: scan,
            status: 200
          })

        } else {
          res.send({
            data: {
              error: "Sidechains not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
}

export async function scanchain(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  const wallet = new Crypto.Wallet
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": fields.sidechain_address }).sort({ block: -1 }).toArray()

        if (sidechain_datas[0] !== undefined) {
          for (let x in sidechain_datas) {
            delete sidechain_datas[x]._id
            sidechain_datas[x].address = await wallet.getAddressFromPubKey(sidechain_datas[x].pubkey)
          }
          res.send({
            data: sidechain_datas,
            status: 200
          })

        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
}

export async function verifychain(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": fields.sidechain_address }).sort({ block: 1 }).toArray()
        let verified = true
        var wallet = new Crypto.Wallet;
        var sidechain = new Sidechain.Wallet;
        if (sidechain_datas[0] !== undefined) {
          for (let x in sidechain_datas) {
            if(verified === true){
              let validatesign = await wallet.verifymessage(sidechain_datas[x].pubkey,sidechain_datas[x].signature,JSON.stringify(sidechain_datas[x].transaction))
              if(validatesign !== false){
                let inputs = sidechain_datas[x].transaction.inputs
                for(let y in inputs){
                  let input = inputs[y]
                  if(input.vout !== "genesis" && input.vout !== "reissue"){
                    let block = sidechain_datas[x].block
                    let validateinput = await sidechain.validateinput(input.sxid, input.vout, fields.sidechain_address, validatesign['address'], block)
                    if(validateinput === false){
                      verified = false
                    }
                  }
                }
              }else{
                console.log('ERROR AT TX ' + JSON.stringify(sidechain_datas[x].transaction))
                verified = false
              }
            }
          }
          res.send({
            verified: verified,
            status: 200
          })

        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
}

export async function transaction(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined && fields.sxid) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        if (check_sidechain[0] !== undefined) {
          var written = await db.collection('written').find({ "data.sxid": fields.sxid }).sort({ block: 1 }).limit(1).toArray()
          delete written[0]._id
          res.json({
            transaction: written[0],
            symbol: check_sidechain[0].data.genesis.symbol,
            sidechain: check_sidechain[0].address
          })
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
};

export function listchains(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  form.parse(req, async function (err, fields, files) {
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
      const db = client.db(global['db_name'])
      let sidechain_datas = await db.collection('written').find({ protocol: 'chain://' }).sort({ block: 1 }).toArray()
      if (sidechain_datas[0] !== undefined) {
        let sidechains = []
        let sidechain_addresses = []
        for (let x in sidechain_datas) {
          if (sidechain_datas[x].data.genesis !== undefined && sidechain_datas[x].data.genesis.time !== undefined) {
            if(sidechain_addresses.indexOf(sidechain_datas[x].address) === -1){
              sidechain_addresses.push(sidechain_datas[x].address)
              sidechain_datas[x].data.address = sidechain_datas[x].address
              sidechains.push(sidechain_datas[x].data)
            }
          }
        }

        res.send({
          data: sidechains,
          status: 200
        })

      } else {
        res.send({
          data: {
            error: "Sidechains not found."
          },
          status: 422
        })
      }
    })
  })
}

export async function shares(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        let decimals = check_sidechain[0].data.genesis.decimals
        if (check_sidechain[0] !== undefined) {
          
          let unspents = await db.collection('sc_unspent').find({sidechain: fields.sidechain_address}).sort({ block: 1 }).toArray()
          let addresses = {}
          let shares = {}
          let percentages = {}
          let cap = 0

          for(let x in unspents){
            let unspent = unspents[x]
            if(addresses[unspent.address] === undefined){
              addresses[unspent.address] = 0
            }
            addresses[unspent.address] += parseFloat(unspent.amount.toFixed(decimals))
            cap += parseFloat(unspent.amount.toFixed(decimals))
          }

          for(let address in addresses){
            let percentage = 100 / cap * addresses[address]
            percentages[address] = parseFloat(percentage.toFixed(decimals))
          }
          
          let keysSorted = Object.keys(addresses).sort(function(a,b){return addresses[b]-addresses[a]})
          for(let x in keysSorted){
            let k = keysSorted[x]
            shares[k] = {
              balance: addresses[k],
              shares: percentages[k]
            }
          }

          res.json({
            shares: shares,
            cap: parseFloat(cap.toFixed(decimals)),
            sidechain: check_sidechain[0].address
          })
          
        } else {
          res.send({
            data: {
              error: "Sidechain not found."
            },
            status: 422
          })
        }
      })
    } else {
      res.send({
        data: {
          error: "Specify all required fields first."
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
}