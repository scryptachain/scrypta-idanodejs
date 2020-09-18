import express = require("express")
const vm = require('@scrypta/vm')
import * as Utilities from '../libs/Utilities'
import * as Crypto from '../libs/Crypto'
import { integritycheck } from "./Wallet"
const mongo = require('mongodb').MongoClient
import { v4 as uuidv4 } from 'uuid'

export async function read(req: express.Request, res: express.Response) {
  let address = req.params.address
  let read = await vm.read(address, true)
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
          let check = await db.collection('contracts').find({ contract: parsed['contract'] }).toArray()
          client.close()
          if (check[0] !== undefined) {
            let run = await vm.run(parsed['contract'], request['body'], true)
            res.send(run)
          } else {
            res.send({ message: 'Smart Contract not available at this node.', error: 400 })
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
    let adminpubkey = await wallet.getPublicKey(process.env.NODE_KEY)
    let verify = await wallet.verifymessage(adminpubkey, request['body']['signature'], request['body']['message'])

    if (adminpubkey === request['body']['pubkey'] && verify !== false) {
      mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let check = await db.collection('contracts').find({ contract: request['body']['message'] }).toArray()
        client.close()
        if (check[0] !== undefined) {
          res.send({ message: 'Contract pinned yet.', status: 501 })
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
        let check = await db.collection('contracts').find({ contract: request['body']['message'] }).toArray()
        client.close()
        if (check[0] === undefined) {
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