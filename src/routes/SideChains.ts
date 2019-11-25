import express = require("express")
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
import * as Sidechain from '../libs/Sidechain'
let CoinKey = require("coinkey")
const mongo = require('mongodb').MongoClient
import * as Utilities from '../libs/Utilities'

const lyraInfo = {
  private: 0xae,
  public: 0x30,
  scripthash: 0x0d
}

export async function issue(req: express.Request, res: express.Response) {
  var wallet = new Crypto.Wallet;
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
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
          "version": fields.version,
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

          var ck = new CoinKey.createRandom(lyraInfo)
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
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
        let decimals = parseInt(check_sidechain[0].data.genesis.decimals)
        let checkto = await wallet.request('validateaddress', [fields.to])

        if (checkto['result'].isvalid === true) {
          if (check_sidechain[0] !== undefined && check_sidechain[0].address === fields.sidechain_address) {
            var scwallet = new Sidechain.Wallet;
            let unspent = await scwallet.listunpent(fields.from, fields.sidechain_address)
            let inputs = []
            let outputs = {}
            let amountinput = 0
            let amount = parseFloat(parseFloat(fields.amount).toFixed(decimals))
            let usedtx = []
            for (let i in unspent) {
              if (amountinput < amount) {
                delete unspent[i]._id
                let checkinput = await db.collection('sc_transactions').find({ sxid: unspent[i].sxid }).limit(1).toArray()
                if (checkinput[0] !== undefined && checkinput[0].transaction.outputs[fields.from] !== undefined && checkinput[0].transaction.outputs[fields.from] === unspent[i].amount) {
                  if (global['sxidcache'].indexOf(unspent[i].sxid) === -1) {
                    inputs.push(unspent[i])
                    usedtx.push(unspent[i].sxid)
                    amountinput += parseFloat(unspent[i].amount.toFixed(check_sidechain[0].data.genesis.decimals))
                  }
                }
              }
            }
            let totaloutputs = 0
            amountinput = parseFloat(amountinput.toFixed(check_sidechain[0].data.genesis.decimals))
            amount = parseFloat(amount.toFixed(check_sidechain[0].data.genesis.decimals))
            if (amountinput >= fields.amount) {

              let change = amountinput - amount
              change = parseFloat(change.toFixed(check_sidechain[0].data.genesis.decimals))

              outputs[fields.to] = amount
              totaloutputs += amount
              if (change > 0) {
                outputs[fields.from] = change
                totaloutputs += change
              }
              totaloutputs = parseFloat(totaloutputs.toFixed(check_sidechain[0].data.genesis.decimals))
              if (inputs.length > 0 && totaloutputs > 0) {
                let transaction = {}
                transaction["sidechain"] = fields.sidechain_address
                transaction["inputs"] = inputs
                transaction["outputs"] = outputs
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
                  // TODO: Send to P2P Network to speed up the transaction.
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

export function reissue(req: express.Request, res: express.Response) {
  /*
    This will write a transaction inside the SideChain adding in effect balance to the owner, only if in the genesis transaction the token have been flagged as "reissuable"
  */
};

export async function getsidechain(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunpent(fields.dapp_address, fields.sidechain_address)
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
    if (fields.dapp_address !== undefined && fields.sidechain_address) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunpent(fields.dapp_address, fields.sidechain_address)
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
    if (fields.dapp_address !== undefined && fields.sidechain_address) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
        if (check_sidechain[0] !== undefined) {
          let transactions = []

          let txs = await db.collection('sc_transactions').find({ "transaction.sidechain": fields.sidechain_address }).sort({ block: -1 }).toArray()
          for (let tx in txs) {
            if (txs[tx].transaction.inputs[0].address === fields.dapp_address || txs[tx].transaction.outputs[fields.dapp_address] !== undefined) {
              delete txs[tx]._id
              let amount = 0
              let recipient = 0
              if (txs[tx].transaction.inputs[0].address === fields.dapp_address) {
                amount -= txs[tx].transaction.inputs[0].amount
              }
              if (txs[tx].transaction.outputs[fields.dapp_address] !== undefined) {
                amount += txs[tx].transaction.outputs[fields.dapp_address]
              }
              let to
              for (let address in txs[tx].transaction.outputs) {
                if (address !== txs[tx].transaction.inputs[0].address) {
                  to = address
                }
              }
              let analyzed = {
                sxid: txs[tx].sxid,
                from: txs[tx].transaction.inputs[0].address,
                to: to,
                amount: parseFloat(amount.toFixed(check_sidechain[0].data.genesis.decimals)),
                block: txs[tx].block
              }
              transactions.push(analyzed)
            }
          }
          res.json({
            transactions: transactions,
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
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
        var scwallet = new Sidechain.Wallet;
        let unspent = await scwallet.listunpent(fields.dapp_address, fields.sidechain_address)
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
          let scan = []
          for (let x in sidechain_datas) {
            if (sidechain_datas[x].data.genesis !== undefined && sidechain_datas[x].data.genesis.time !== undefined) {
              sidechain_datas[x].data.address = sidechain_datas[x].address
              sidechains.push(sidechain_datas[x].data)
            }
          }
          for (let y in sidechains) {
            let balance = 0
            let unspent = await scwallet.listunpent(fields.dapp_address, sidechains[y].address)
            if (unspent.length > 0) {
              for (let z in unspent) {
                balance += unspent[z].amount
              }
            }
            if (balance > 0) {
              scan.push({
                sidechain: sidechains[y].address,
                symbol: sidechains[y].genesis.symbol,
                balance: balance
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

export async function transaction(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if (request !== false) {
    let fields = request['body']
    if (fields.sidechain_address !== undefined && fields.sxid) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check_sidechain = await db.collection('written').find({ address: fields.sidechain_address }).sort({ block: 1 }).limit(1).toArray()
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
        for (let x in sidechain_datas) {
          if (sidechain_datas[x].data.genesis !== undefined && sidechain_datas[x].data.genesis.time !== undefined) {
            sidechain_datas[x].data.address = sidechain_datas[x].address
            sidechains.push(sidechain_datas[x].data)
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

export function verify(req: express.Request, res: express.Response) {
  /*
    With this operation the IdaNode will check every side-transaction written on the blockchain, preventing to malicious, malformed or invalid transactions that will eventually pass the validation to be written on the main database. This is a secondary verification feature because, in effect, every client will check his own transactions and, if there's something strange, the transaction will be rejected by the client which in effect rejects the payment. The verification will be recursive so every new block if there's one or more sidechain transaction the Idanode will check the previous tx and write it into the database if it's valid. A full rescan can be performed to make sure that's all working but, again, if one hash is not working it will never be written so it's unspendable (even if it's written in the blockchain).
  */
};