import express = require("express")
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
import * as Sidechain from '../libs/Planum'
let CoinKey = require("coinkey")
const mongo = require('mongodb').MongoClient
import * as Utilities from '../libs/Utilities'
import { create, all } from 'mathjs'
import { v4 as uuidv4 } from 'uuid';
import Contracts = require("../libs/Contracts")
const messages = require('../libs/p2p/messages.js')
const CryptoJS = require('crypto-js')
const ScryptaCore = require('@scrypta/core')
const scrypta = new ScryptaCore
const axios = require('axios')
const utils = new Utilities.Parser

const config = {
  epsilon: 1e-12,
  matrix: 'Matrix',
  number: 'number',
  precision: 64,
  predictable: false,
  randomSeed: null
}
const math = create(all, config)

export async function issue(req: express.Request, res: express.Response) {
  var wallet = new Crypto.Wallet;
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.name !== undefined && fields.burnable !== undefined && fields.supply !== undefined && fields.symbol !== undefined && fields.reissuable !== undefined && fields.extendable !== undefined && fields.dapp_address !== undefined && fields.pubkey !== undefined && fields.version !== undefined && fields.private_key !== undefined && fields.decimals !== undefined) {
      let supply = parseFloat(fields.supply)
      if (supply > 0) {

        var burnable = true
        if (fields.burnable === 'false' || fields.burnable === false) {
          burnable = false
        }

        var extendable = false
        var contract = ''
        let contractExist = false
        if (fields.extendable === 'true' || fields.extendable === true) {
          extendable = true
          if (fields.contract !== undefined) {
            let checkcontract = await wallet.request('validateaddress', [fields.contract])
            if (checkcontract['result'].isvalid === true) {
              contract = fields.contract
            }
          }
        }

        if (contract !== '' && extendable === true) {
          let local = new Contracts.Local
          let checkexistence = await local.find(contract, 'latest')
          if (checkexistence.address !== undefined && checkexistence.address === contract) {
            contractExist = true
          }
        }

        var reissuable = true
        if (fields.reissuable === 'false' || fields.reissuable === false) {
          reissuable = false
        }

        var dna = ''
        if (fields.dna !== undefined && fields.dna !== '') {
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
          "extendable": extendable,
          "contract": contract,
          "version": fields.version,
          "dna": dna,
          "time": new Date().getTime()
        }

        if ((extendable === true && contract !== '' && contractExist === true) || extendable === false) {
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
                var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
                var collection = '!*!'
                var refID = '!*!'
                var protocol = '!*!chain://'
                var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(issue) + '*!*'

                let write = await wallet.writemultisig(private_keys, trustlink, redeemScript, dataToWrite, uuid, collection, refID, protocol)

                // MOVE ALL FUNDS FROM SIDECHAIN ADDRESS TO OWNER ADDRESS
                var uuidtx = uuidv4().replace(new RegExp('-', 'g'), '.')

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
              error: "Contract address is not valid."
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

export async function checksidechain(req: express.Request, res: express.Response) {
  if (req.params.sidechain !== undefined) {
    const sidechain = req.params.sidechain
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
      const db = client.db(global['db_name'])
      let verified = true
      let sxids = []
      let cap = 0
      let issued = 0
      let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
      if (check_sidechain[0] !== undefined) {
        let issue = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        let unspents = await db.collection('sc_unspent').find({ sidechain: sidechain, redeemed: null }).sort({ block: 1 }).toArray()
        issued += issue[0].data.genesis.supply
        let reissues = await db.collection('written').find({ address: check_sidechain[0].data.genesis.owner, "data.reissue": { $exists: true } }).sort({ block: 1 }).toArray()
        let decimals = check_sidechain[0].data.genesis.decimals

        // CALCULATING REISSUES
        let reissuestxs = []
        for (let k in reissues) {
          if (reissuestxs.indexOf(reissues[k].data.signature) === -1) {
            reissuestxs.push(reissues[k].data.signature)
            issued = math.sum(issued, reissues[k].data.reissue.supply)
          }
        }

        // CALCULATING CURRENT CAP
        let users = []
        for (let x in unspents) {
          let unspent = unspents[x]
          if (unspent.sxid !== undefined && unspent.sxid !== null && sxids.indexOf(unspent.sxid + ':' + unspent.vout) === -1) {
            sxids.push(unspent.sxid + ':' + unspent.vout)
            let amount = math.round(unspent.amount, decimals)
            cap = math.sum(cap, amount)
            if(users.indexOf(unspent.address) === -1){
              users.push(unspent.address)
            }
          }
        }
        cap = math.round(cap, decimals)
        issued = math.round(issued, decimals)
        if (cap !== issued) {
          // verified = false
        }
        let sidechain_hash = CryptoJS.SHA256(JSON.stringify(sxids)).toString(CryptoJS.enc.Hex)
        let response = { 
          user_count: users.length, 
          cap: cap, issued: issued,
          nodes: [], 
          verified: verified, 
          sidechain: check_sidechain[0].data.genesis, 
          status: sidechain_hash, 
          users: users 
        }
        check_sidechain[0].data.genesis.address = sidechain
        if(verified === true && req.params.consensus !== undefined){
          scrypta.staticnodes = true
          if(process.env.LINKED_NODES !== undefined){
            scrypta.mainnetIdaNodes = process.env.LINKED_NODES.split(',')
          }
          var consensus = 0
          var nodes = 0
          nodes = scrypta.mainnetIdaNodes.length
          for(let k in scrypta.mainnetIdaNodes){
            let node = scrypta.mainnetIdaNodes[k]
              try{
                if(process.env.PUBLIC_DOMAIN === undefined || node !== process.env.PUBLIC_DOMAIN){
                let status = await axios.get(node + '/sidechain/check/' + sidechain, { timeout: 2000 }).catch(err => {
                  utils.log("ERROR ON IDANODE " + node, '', 'errors')
                  nodes--
                })
                if(status.data !== undefined && status.data.verified !== undefined && status.data.verified === true){
                  if(status.data.status === sidechain_hash){
                    consensus++
                    response.nodes.push(node)
                  }
                }
              }else if(process.env.PUBLIC_DOMAIN !== undefined && process.env.PUBLIC_DOMAIN === node){
                nodes--
              }
            }catch(e){
              utils.log('NODE ' + node + ' NOT WORKING', '', 'errors')
            }
          }
          var percentage = Math.round(consensus / nodes * 100)
          response['consensus'] = consensus + '/' + nodes
          response['reliability'] = percentage
          if(percentage < 50){
            response.verified = false
          }
        }
        client.close()
        res.send(response)
      } else {
        res.send('Sidechain not found.')
      }
    })
  } else {
    res.send('Provide sidechain first.')
  }
}

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
            let amount = math.round(fields.amount, decimals)
            let usedtx = []
            for (let i in unspent) {
              if (amountinput < amount) {
                delete unspent[i]._id
                delete unspent[i].sidechain
                delete unspent[i].address
                let checkinput = await db.collection('sc_transactions').find({ sxid: unspent[i].sxid }).limit(1).toArray()
                if (checkinput[0] !== undefined && checkinput[0].transaction.outputs[fields.from] !== undefined && checkinput[0].transaction.outputs[fields.from] === unspent[i].amount) {
                  if (global['sxidcache'].indexOf(unspent[i].sxid + ':' + unspent[i].vout) === -1) {
                    delete unspent[i].block
                    delete unspent[i].redeemblock
                    delete unspent[i].redeemed
                    let validateinput = await scwallet.validateinput(unspent[i].sxid, unspent[i].vout, fields.sidechain_address, fields.from)
                    let isDoubleSpended = await scwallet.checkdoublespending(unspent[i].sxid, unspent[i].vout, fields.sidechain_address, "")
                    if (validateinput === true && isDoubleSpended === false) {
                      inputs.push(unspent[i])
                      usedtx.push(unspent[i].sxid + ':' + unspent[i].vout)
                      let toadd = math.round(unspent[i].amount, decimals)
                      amountinput = math.sum(amountinput, toadd)
                      amountinput = math.round(amountinput, decimals)
                    } else {
                      parser.log('FOUND DOUBLE SPENDED TRANSACTION ' + unspent[i].sxid + ':' + unspent[i].vout)
                    }
                  }
                }
              }
            }
            let totaloutputs = 0
            amountinput = math.round(amountinput, decimals)
            amount = math.round(amount, decimals)
            client.close()
            if (amountinput >= fields.amount) {

              if (fields.to === check_sidechain[0].address && check_sidechain[0].data.burnable === false) {

                res.send({
                  error: true,
                  description: "Can\'t burn asset.",
                  status: 422
                })

              } else {

                outputs[fields.to] = amount
                totaloutputs = math.sum(totaloutputs, amount)

                let change = <number>math.subtract(amountinput, amount)
                change = math.round(change, check_sidechain[0].data.genesis.decimals)
                if (fields.to !== fields.from) {
                  if (change > 0 && fields.change === undefined) {
                    outputs[fields.from] = change
                    totaloutputs = math.sum(totaloutputs, change)
                  } else if (change > 0 && fields.change !== undefined) {
                    // CHECK IF CHANGE ADDRESS IS VALID
                    let checkchange = await wallet.request('validateaddress', [fields.change])
                    if (checkchange['result'].isvalid === true) {
                      outputs[fields.change] = change
                      totaloutputs = math.sum(totaloutputs, change)
                    } else {
                      // IF NOT, SEND TO MAIN ADDRESS
                      outputs[fields.from] = change
                      totaloutputs = math.sum(totaloutputs, change)
                    }
                  }
                } else {
                  if (change > 0) {
                    outputs[fields.from] = math.sum(change, amount)
                    outputs[fields.from] = math.round(outputs[fields.from], check_sidechain[0].data.genesis.decimals)
                    totaloutputs = math.sum(totaloutputs, change)
                  }
                }

                totaloutputs = math.round(totaloutputs, check_sidechain[0].data.genesis.decimals)

                if (inputs.length > 0 && totaloutputs > 0) {
                  let transaction = {}
                  transaction["sidechain"] = fields.sidechain_address
                  transaction["inputs"] = inputs
                  transaction["outputs"] = outputs
                  let memo = ''
                  if (fields.memo !== undefined) {
                    memo = fields.memo
                  }
                  transaction["memo"] = memo
                  transaction["time"] = new Date().getTime()

                  let signtx = await wallet.signmessage(fields.private_key, JSON.stringify(transaction))

                  let tx = {
                    transaction: transaction,
                    signature: signtx.signature,
                    pubkey: signtx.pubkey,
                    sxid: signtx.id
                  }
                  var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
                  var collection = '!*!'
                  var refID = '!*!'
                  var protocol = '!*!chain://'
                  var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(tx) + '*!*'

                  let write = await wallet.write(fields.private_key, fields.from, dataToWrite, uuid, collection, refID, protocol)
                  if (write !== false) {
                    res.send(write)
                    for (let x in usedtx) {
                      global['sxidcache'].push(usedtx[x])
                      await messages.signandbroadcast('planum-unspent', usedtx[x])
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
        client.close()
        if (check_sidechain[0] !== undefined) {
          if (check_sidechain[0].data.genesis.reissuable === true) {
            let supply = parseFloat(fields.supply)
            var dna = ''
            if (fields.dna !== undefined && fields.dna !== '') {
              dna = fields.dna
            }

            if (supply > 0) {

              let reissue = {
                "sidechain": fields.sidechain_address,
                "owner": fields.dapp_address,
                "supply": supply,
                "dna": dna,
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
                var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
                var collection = '!*!'
                var refID = '!*!'
                var protocol = '!*!chain://'
                var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(signed) + '*!*'
                let write = await wallet.write(fields.private_key, fields.dapp_address, dataToWrite, uuid, collection, refID, protocol)

                // CREATE REISSUE UNSPENT
                var uuidtx = uuidv4().replace(new RegExp('-', 'g'), '.')

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
              } else {
                res.send({
                  error: 'Sign don\'t match',
                  status: 402
                })
              }
            } else {
              res.send({
                data: {
                  error: "Supply must be greater than 0."
                },
                status: 422
              })
            }
          } else {
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
        client.close()
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
        client.close()
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
          client.close()
          for (let tx in txs) {
            let from = await wallet.getAddressFromPubKey(txs[tx].pubkey)
            if (from === fields.dapp_address || txs[tx].transaction.outputs[fields.dapp_address] !== undefined) {
              delete txs[tx]._id
              var isGenesis = false
              var isReissue = false
              for (let x in txs[tx].transaction.inputs) {
                if (txs[tx].transaction.inputs[x].vout === 'genesis') {
                  isGenesis = true
                  from = "GENESIS"
                } else if (txs[tx].transaction.inputs[x].vout === 'reissue') {
                  isReissue = true
                  from = "REISSUE"
                }
              }
              let to
              let amount

              if (!isGenesis && !isReissue) {
                for (let y in txs[tx].transaction.outputs) {
                  if (y !== from) {
                    amount = txs[tx].transaction.outputs[y]
                  }
                }

                for (let address in txs[tx].transaction.outputs) {
                  if (address !== from) {
                    to = address
                  }
                }

                if (to !== fields.dapp_address) {
                  amount = amount * -1
                }
                if (to === undefined) {
                  to = from
                  amount = txs[tx].transaction.outputs[to]
                }
              } else {
                to = await wallet.getAddressFromPubKey(txs[tx].pubkey)
                amount = txs[tx].transaction.outputs[to]
              }
              let memo = ''
              if (txs[tx].transaction.memo !== undefined) {
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

              if (txs[tx].block !== null) {
                transactions.push(analyzed)
              } else {
                unconfirmed.push(analyzed)
              }
            }
          }

          let response_txs = []
          for (let x in unconfirmed) {
            response_txs.push(unconfirmed[x])
          }
          for (let y in transactions) {
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
        client.close()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunspent(fields.dapp_address, fields.sidechain_address)

        let balance = 0
        for (let k in unspent) {
          balance += parseFloat(unspent[k].amount.toFixed(check_sidechain[0].data.genesis.decimals))
        }

        if (check_sidechain[0] !== undefined) {
          res.json({
            unspent: unspent,
            balance: parseFloat(balance.toFixed(check_sidechain[0].data.genesis.decimals)),
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
        client.close()
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
        client.close()
        let uniq = []
        if (sidechain_datas[0] !== undefined) {
          for (let x in sidechain_datas) {
            delete sidechain_datas[x]._id
            if (uniq.indexOf(sidechain_datas[x].sxid) === -1) {
              sidechain_datas[x].address = await wallet.getAddressFromPubKey(sidechain_datas[x].pubkey)
              uniq.push(sidechain_datas[x].sxid)
            }
          }
          sidechain_datas.sort(function (a, b) {
            return parseFloat(b.transaction.time) - parseFloat(a.transaction.time);
          });
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

export async function validatetransaction(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    let transactionToValidate = fields.transaction.transaction
    if (transactionToValidate !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        var db = client.db(global['db_name'])
        var scwallet = new Sidechain.Wallet;
        let check_sidechain = await db.collection('written').find({ address: transactionToValidate.sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        client.close()
        let error_code = ''
        let checks_code = ''
        if (check_sidechain[0] !== undefined) {
          let valid = true
          var amountinput = 0
          var amountoutput = 0
          var isGenesis = false
          let time = transactionToValidate.time
          if (transactionToValidate.inputs.length > 0) {
            for (let x in transactionToValidate.inputs) {
              let sxid = transactionToValidate.inputs[x].sxid
              let vout = transactionToValidate.inputs[x].vout
              // VALIDATING INPUT TIME
              let validatetime = true
              if (transactionToValidate.inputs[x].time >= time) {
                validatetime = false
              }

              if (validatetime === false) {
                valid = false
                res.send({
                  message: "Input time greater than input tx.",
                  error: true,
                  status: 404
                })
              } else {
                checks_code += '> TIME_VALIDATED'
                let validategenesis = await scwallet.validategenesis(sxid, transactionToValidate.sidechain)
                if (validategenesis === false) {
                  let validateinput = await scwallet.validateinput(sxid, vout, transactionToValidate.sidechain, fields.address)
                  if (validateinput === false) {
                    valid = false
                    res.send({
                      message: "Input " + sxid + ':' + vout + " not valid.",
                      error: true,
                      status: 404
                    })
                  } else if (validateinput === true) {
                    let isDoubleSpended = await scwallet.checkdoublespending(sxid, vout, transactionToValidate.sidechain, fields.sxid)
                    if (isDoubleSpended === true) {
                      valid = false
                      res.send({
                        message: "Input " + sxid + ':' + vout + " is spended yet.",
                        error: true,
                        status: 404
                      })
                    }
                    checks_code += ' > DOUBLE_SPENDING_VALIDATED'
                  }
                }
                // CHECKING GENESIS
                if (transactionToValidate.inputs[x].vout === 'genesis' || transactionToValidate.inputs[x].vout === 'reissue') {
                  isGenesis = true
                }
                if (check_sidechain[0].data.genesis !== undefined) {
                  if (valid === true && transactionToValidate.inputs[x].amount !== undefined) {
                    let fixed = math.round(transactionToValidate.inputs[x].amount, check_sidechain[0].data.genesis.decimals)
                    amountinput = math.sum(amountinput, fixed)
                    checks_code += ' > FIXED_AMOUNT_VALIDATED'
                  }
                } else {
                  valid = false
                  res.send({
                    message: "Sidechain doesn't exist.",
                    error: true,
                    status: 404
                  })
                }
              }
            }
          } else {
            error_code = 'NO_INPUTS'
            valid = false
          }

          if (check_sidechain[0].data.genesis !== undefined) {
            if (valid === true) {
              for (let x in transactionToValidate.outputs) {
                let fixed = math.round(transactionToValidate.outputs[x], check_sidechain[0].data.genesis.decimals)
                amountoutput = math.sum(amountoutput, fixed)
              }
              checks_code += ' > OUTPUT_VALIDATED'
            }
            amountoutput = math.round(amountoutput, check_sidechain[0].data.genesis.decimals)
            amountinput = math.round(amountinput, check_sidechain[0].data.genesis.decimals)
          } else {
            error_code = 'NO_SIDECHAIN'
            valid = false
          }

          if (!isGenesis) {
            if (valid === true && amountoutput > amountinput) {
              valid = false
              res.send({
                message: "Output amount is higher than input amount",
                error: true,
                status: 404
              })
            } else {
              checks_code += ' > NO_OVERMINT_VALIDATED'
            }
          }

          // CHECK SIGNATURE
          var wallet = new Crypto.Wallet;
          if (valid === true && fields.pubkey !== undefined && fields.signature !== undefined && transactionToValidate !== undefined) {
            let validatesign = await wallet.verifymessage(fields.pubkey, fields.signature, JSON.stringify(transactionToValidate))
            if (validatesign === false) {
              error_code = 'SIGN_CHECK_FAIL'
              valid = false
            }
          } else {
            valid = false
          }

          if (valid === true) {
            res.send({
              message: "Transaction is valid",
              valid: true,
              status: 200
            })
          } else {
            res.send({
              message: "Transaction is not valid",
              valid: false,
              status: error_code,
              checks: checks_code
            })
          }
        } else {
          res.send({
            message: "Sidechain doesn't exist",
            error: true,
            status: 404
          })
        }
      })
    } else {
      res.send({
        message: "Nothing to validate",
        error: true,
        status: 404
      })
    }
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
        let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": fields.sidechain_address }).sort({ "transaction.time": 1 }).toArray()
        client.close()
        let verified = true
        var wallet = new Crypto.Wallet;
        var sidechain = new Sidechain.Wallet;
        let errors = []
        if (sidechain_datas[0] !== undefined) {
          for (let x in sidechain_datas) {
            if (verified === true) {
              let pubkey
              if (sidechain_datas[x].pubkey !== undefined) {
                pubkey = sidechain_datas[x].pubkey
              } else if (sidechain_datas[x].pubKey !== undefined) {
                pubkey = sidechain_datas[x].pubKey
              }
              if (pubkey !== undefined && pubkey.length > 0) {
                let validatesign = await wallet.verifymessage(pubkey, sidechain_datas[x].signature, JSON.stringify(sidechain_datas[x].transaction))
                if (validatesign !== false) {
                  let inputs = sidechain_datas[x].transaction.inputs
                  for (let y in inputs) {
                    let input = inputs[y]
                    if (input.vout !== "genesis" && input.vout !== "reissue") {
                      let block = sidechain_datas[x].block
                      let validateinput = await sidechain.checkinputspent(input.sxid, input.vout, fields.sidechain_address, validatesign['address'], block)
                      let isdoublespended = await sidechain.checkdoublespending(input.sxid, input.vout, fields.sidechain_address, sidechain_datas[x].sxid)
                      if (validateinput === false || isdoublespended === true) {
                        verified = false
                        errors.push(sidechain_datas[x].sxid + ':' + sidechain_datas[x].block)
                        console.log('ERROR VALIDATING INPUT ' + input.sxid + ':' + input.vout)
                      }
                    }
                  }
                } else {
                  console.log('ERROR AT TX ' + JSON.stringify(sidechain_datas[x].transaction))
                  verified = false
                }
              } else {
                console.log('ERROR AT TX ' + JSON.stringify(sidechain_datas[x].transaction))
                verified = false
              }
            }
          }
          res.send({
            verified: verified,
            errors: errors,
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
          var written = await db.collection('sc_transactions').find({ "sxid": fields.sxid }).sort({ block: -1 }).limit(1).toArray()
          client.close()
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
  var parser = new Utilities.Parser
  form.parse(req, async function (err, fields, files) {
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
      const db = client.db(global['db_name'])
      let sidechain_datas = await db.collection('written').find({ protocol: 'chain://' }).sort({ block: 1 }).toArray()
      if (sidechain_datas[0] !== undefined) {
        let sidechains = []
        let sidechain_addresses = []
        for (let x in sidechain_datas) {
          if (sidechain_datas[x].data.genesis !== undefined && sidechain_datas[x].data.genesis.time !== undefined) {
            if (sidechain_addresses.indexOf(sidechain_datas[x].address) === -1) {

              sidechain_addresses.push(sidechain_datas[x].address)
              sidechain_datas[x].data.address = sidechain_datas[x].address
              sidechain_datas[x].data.last_24 = 0

              let txs = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain_datas[x].address }).sort({ block: -1 }).toArray()
              let last = txs[0]
              for (let yy in txs) {
                let ts = math.round(txs[yy].transaction.time / 1000)
                var tsNow = math.round(new Date().getTime() / 1000)
                var tsYesterday = tsNow - (24 * 3600)
                if (ts >= tsYesterday) {
                  sidechain_datas[x].data.last_24++
                }
              }

              if (last !== undefined) {
                sidechain_datas[x].data.last_tx = {
                  time: parser.timeToDate(last.transaction.time),
                  sxid: last.sxid,
                  block: last.block
                }
              }

              sidechains.push(sidechain_datas[x].data)
            }
          }
        }

        client.close()

        sidechains.sort(function (a, b) {
          return parseFloat(b.last_24) - parseFloat(a.last_24);
        })

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
  var scwallet = new Sidechain.Wallet;
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
        let decimals = check_sidechain[0].data.genesis.decimals
        if (check_sidechain[0] !== undefined) {

          let unspents = await db.collection('sc_unspent').find({ sidechain: fields.sidechain_address, redeemed: null }).sort({ block: 1 }).toArray()
          client.close()
          let addresses = {}
          let shares = {}
          let percentages = {}
          let cap = 0
          let burned = 0
          let sxids = []
          for (let x in unspents) {
            let unspent = unspents[x]
            if (unspent.sxid !== undefined && unspent.sxid !== null && sxids.indexOf(unspent.sxid + ':' + unspent.vout) === -1) {
              sxids.push(unspent.sxid + ':' + unspent.vout)
              if (addresses[unspent.address] === undefined) {
                addresses[unspent.address] = 0
              }
              let amount = math.round(unspent.amount, decimals)
              addresses[unspent.address] += amount
              cap = math.sum(cap, amount)
            }
          }

          for (let address in addresses) {
            let percentage = math.evaluate('100 / ' + cap + ' * ' + addresses[address])
            percentages[address] = math.round(percentage, decimals)
          }

          let keysSorted = Object.keys(addresses).sort(function (a, b) { return addresses[b] - addresses[a] })
          for (let x in keysSorted) {
            let k = keysSorted[x]
            shares[k] = {
              balance: math.round(addresses[k], decimals),
              shares: percentages[k]
            }
          }

          if (addresses[fields.sidechain_address] !== undefined) {
            burned = addresses[fields.sidechain_address]
          }

          res.json({
            shares: shares,
            cap: math.round(cap, decimals),
            burned: math.round(burned, decimals),
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