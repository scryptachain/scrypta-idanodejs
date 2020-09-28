import express = require("express")
const vm = require('@scrypta/vm')
import * as Utilities from '../libs/Utilities'
import * as Crypto from '../libs/Crypto'
import * as Contracts from '../libs/Contracts'
const mongo = require('mongodb').MongoClient
import { v4 as uuidv4 } from 'uuid'

export async function readlast(req: express.Request, res: express.Response) {
  let address = req.params.address
  let read = await vm.read(address, true)
  res.send(read)
}

export async function readversion(req: express.Request, res: express.Response) {
  let address = req.params.address
  let version = req.params.version
  let read = await vm.read(address, true, version)
  res.send(read)
}

export async function run(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)

  if (request['body']['message'] !== undefined) {
    try {
      let decoded = Buffer.from(request['body']['message'], 'hex').toString('utf8')
      let parsed = JSON.parse(decoded)
      if (parsed['contract'] !== undefined && parsed['function'] !== undefined && parsed['params'] !== undefined) {
        mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
          const db = client.db(global['db_name'])
          let local = new Contracts.Local
          let pinned = await local.pinned()
          let isPinned = false
          let parsed = Buffer.from(request['body']['message'], 'hex').toString('utf-8')
          try {
            parsed = JSON.parse(parsed)
            let contract = parsed['contract']
            let version = parsed['version']
            for (let k in pinned) {
              if (pinned[k].contract === contract) {
                isPinned = true
                version = pinned[k].version
              }
            }
            client.close()
            if (isPinned) {
              if (parsed['function'] !== 'eachBlock' && parsed['function'] !== 'ifMempool') {
                let run = await vm.run(parsed['contract'], request['body'], true, version)
                res.send(run)
              } else {
                res.send({ message: 'Can\'t run eachBlock or ifMempool function.', request: parsed, error: 400 })
              }
            } else {
              res.send({ message: 'Smart Contract not available at this node.', request: parsed, error: 400 })
            }
          } catch (e) {
            console.log(e)
            res.send({ message: 'Invalid request.', request: parsed, error: 400 })
          }
        })
      } else {
        res.send({ message: 'Please send a valid reqeust', error: 400 })
      }
    } catch (e) {
      res.send({ message: 'Please send a valid reqeust', error: 400 })
    }
  } else {
    res.send({ message: 'Please send a valid reqeust', error: 400 })
  }
}

export async function pin(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)

  if (request['body']['message'] !== undefined) {
    let wallet = new Crypto.Wallet
    let local = new Contracts.Local
    let adminpubkey = await wallet.getPublicKey(process.env.NODE_KEY)
    let verify = await wallet.verifymessage(adminpubkey, request['body']['signature'], request['body']['message'])

    if (adminpubkey === request['body']['pubkey'] && verify !== false) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let pinned = await local.pinned()
        let isPinned = false
        let pinnedobj
        let contract
        let version
        if (request['body']['message'].indexOf(':') !== -1) {
          let exp = request['body']['message'].split(':')
          contract = exp[0]
          version = exp[1]
        }
        for (let k in pinned) {
          if (pinned[k].contract === contract) {
            pinnedobj = pinned[k]
            isPinned = true
          }
        }
        client.close()
        if (isPinned) {
          res.send({ message: 'Contract pinned yet.', pinned: pinnedobj, status: 501 })
        } else {
          let unspent = await wallet.listunpent(request['body']['address'])
          let balance = 0
          for (let k in unspent) {
            let utxo = unspent[k]
            balance += utxo['amount']
          }

          if (balance > 0.001) {
            var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
            var collection = '!*!'
            let refID = '!*!' + adminpubkey
            var protocol = '!*!pin://'
            var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + request['body']['message'] + '*!*'
            let write = await wallet.write(process.env.NODE_KEY, request['body']['address'], dataToWrite, uuid, collection, refID, protocol)
            res.send({ message: 'Contract pinned.', tx: write, status: 200 })
          } else {
            res.send({ message: 'Not enough funds.', status: 502 })
          }
        }
      })
    } else {
      res.send({ message: 'Not authorized', error: 400 })
    }
  } else {
    res.send({ message: 'Please send a valid reqeust', error: 400 })
  }
}

export async function unpin(req: express.Request, res: express.Response) {
  var parser = new Utilities.Parser
  var request = await parser.body(req)

  if (request['body']['message'] !== undefined) {
    let wallet = new Crypto.Wallet
    let adminpubkey = await wallet.getPublicKey(process.env.NODE_KEY)
    let verify = await wallet.verifymessage(adminpubkey, request['body']['signature'], request['body']['message'])

    if (adminpubkey === request['body']['pubkey'] && verify !== false) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let local = new Contracts.Local
        let pinned = await local.pinned()
        let isPinned = false
        let pinnedobj
        let contract
        let version
        if (request['body']['message'].indexOf(':') !== -1) {
          let exp = request['body']['message'].split(':')
          contract = exp[0]
          version = exp[1]
        }
        for (let k in pinned) {
          if (pinned[k].contract === contract) {
            pinnedobj = pinned[k]
            isPinned = true
          }
        }
        client.close()
        if (!isPinned) {
          res.send({ message: 'Contract unpinned yet.', status: 501 })
        } else {
          let unspent = await wallet.listunpent(request['body']['address'])
          let balance = 0
          for (let k in unspent) {
            let utxo = unspent[k]
            balance += utxo['amount']
          }

          if (balance > 0.001) {
            var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
            var collection = '!*!'
            let refID = '!*!' + adminpubkey
            var protocol = '!*!unpin://'
            var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + request['body']['message'] + '*!*'
            let write = await wallet.write(process.env.NODE_KEY, request['body']['address'], dataToWrite, uuid, collection, refID, protocol)
            res.send({ message: 'Contract unpinned.', tx: write, status: 200 })
          } else {
            res.send({ message: 'Not enough funds.', status: 502 })
          }
        }
      })
    } else {
      res.send({ message: 'Not authorized', error: 400 })
    }
  } else {
    res.send({ message: 'Please send a valid reqeust', error: 400 })
  }
}

export async function get(req: express.Request, res: express.Response) {
  let local = new Contracts.Local
  let contracts = await local.all()
  let pinned = await local.pinned()
  res.send({ contracts: contracts, pinned: pinned })
}