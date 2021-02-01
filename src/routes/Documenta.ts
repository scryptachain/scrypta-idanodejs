import express = require("express")
const ft = require('file-type')
var fs = require('fs')
var formidable = require('formidable')
import * as Space from '../libs/Space'
import * as Crypto from '../libs/Crypto'
const crypto = require('crypto')
const LZUTF8 = require('lzutf8')
import { v4 as uuidv4 } from 'uuid'
const ScryptaCore = require('@scrypta/core')
const mongo = require('mongodb').MongoClient

export async function add(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  let space = new Space.syncer
  var wallet = new Crypto.Wallet;
  form.maxFileSize = global['limit'] * 1024 * 1024
  form.maxFieldsSize = global['limit'] * 1024 * 1024
  form.multiples = true
  if (req.body.signature !== undefined && req.body.message !== undefined && req.body.pubkey !== undefined) {
    let validatesign = await wallet.verifymessage(req.body.pubkey, req.body.signature, req.body.message)
    if (validatesign) {
      let buf = Buffer.from(req.body.message, 'hex')
      try {
        let hash = crypto.createHash("sha256").update(buf).digest("hex")
        let uploaded = await space.uploadToSpace(hash, buf, validatesign['address'])
        if (uploaded !== false) {
          let written = 'Private key not provided'
          if (req.body.private_key !== undefined) {
            let refID = '!*!'
            if (req.body.title !== undefined) {
              refID += LZUTF8.compress(req.body.title, { outputEncoding: "Base64" })
            }
            var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
            var collection = '!*!'
            var protocol = '!*!documenta://'
            let signed = await wallet.signmessage(req.body.private_key, JSON.stringify(uploaded))
            var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(signed) + '*!*'
            written = <string>await wallet.write(req.body.private_key, validatesign['address'], dataToWrite, uuid, collection, refID, protocol)
          }

          res.send({
            space: 'https://' + process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT + '/' + validatesign['address'] + '/' + hash,
            uploaded: uploaded,
            address: validatesign['address'],
            written: written,
            status: 200
          })
        } else {
          res.send({
            error: true,
            status: 500
          })
        }
      } catch (e) {
        res.send({
          error: true,
          status: 500
        })
      }
    } else {
      res.send({
        error: "Can't validate signature, please retry.",
        status: 422
      })
    }
  } else {
    form.parse(req, async function (err, fields, files) {
      try {
        const scrypta = new ScryptaCore(false, ['http://localhost:3001'])
        scrypta.staticnodes = true
        let temporary = await scrypta.importPrivateKey(fields.private_key, '-')
        let balance = await wallet.balanceOf(temporary.pub)
        if (balance > 0) {
          let content = fs.readFileSync(files.file.path)
          let hash = crypto.createHash("sha256").update(content).digest("hex")
          let uploaded = await space.uploadToSpace(hash, content, temporary.pub)
          let refID = '!*!'
          if (fields.title !== undefined) {
            refID += LZUTF8.compress(fields.title, { outputEncoding: "Base64" })
          }
          var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
          var collection = '!*!'
          var protocol = '!*!documenta://'
          let signed = await wallet.signmessage(fields.private_key, JSON.stringify(uploaded))
          var dataToWrite = '*!*' + uuid + collection + refID + protocol + '*=>' + JSON.stringify(signed) + '*!*'
          let written = <string>await wallet.write(fields.private_key, signed['address'], dataToWrite, uuid, collection, refID, protocol)

          res.send({
            uploaded: uploaded,
            address: signed['address'],
            written: written,
            status: 200
          })
        } else {
          res.send({
            error: true,
            address: temporary.pub,
            message: "Not enough balance",
            status: 500
          })
        }
      } catch (e) {
        console.log(e)
        res.send({
          error: true,
          status: 500
        })
      }
    })
  }
};

export async function get(req: express.Request, res: express.Response) {
  let space = new Space.syncer
  let s3 = process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT
  let downloaded = await space.downloadFromSpace(req.params.hash, s3, req.params.address)
  if (downloaded !== false) {
    try {
      let filetype = await ft.fromBuffer(downloaded)
      res.set('Content-Type', filetype.mime);
      res.end(downloaded)
    } catch (e) {
      res.send(downloaded)
    }
  } else {
    res.send({ message: 'Error while downloading file', error: true })
  }
};

export async function read(req: express.Request, res: express.Response) {
  let s3 = process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT
  try {
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
      if (client !== undefined) {
        const db = client.db(global['db_name'])
        let documenta = await db.collection('documenta').find({ "address": req.params.address }).sort({ block: -1 }).toArray()
        let response = []
        for (let k in documenta) {
          delete documenta[k]['_id']
          try {
            documenta[k].endpoint = LZUTF8.decompress(documenta[k].endpoint, { inputEncoding: "Base64" })
          } catch (e) { }
          try {
            documenta[k].refID = LZUTF8.decompress(documenta[k].refID, { inputEncoding: "Base64" })
          } catch (e) { }
          documenta[k].space = 'https://' + documenta[k].endpoint + '/' + documenta[k].address + '/' + documenta[k].file
          response.push(documenta[k])
        }
        client.close()
        res.send(response)
      } else {
        res.json({
          error: true,
          message: "Idanode not working, please retry"
        })
      }
    })
  } catch (e) {
    res.json({
      error: true,
      message: "Can't connect to wallet"
    })
  }
};

export async function returnDoc(req: express.Request, res: express.Response) {
  let s3 = process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT
  try {
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
      if (client !== undefined) {
        const db = client.db(global['db_name'])
        let doc = await db.collection('documenta').findOne({ "address": req.params.address, "file": req.params.hash })
        client.close()
        if (doc !== undefined && doc !== null) {
          delete doc['_id']
          try {
            doc.endpoint = LZUTF8.decompress(doc.endpoint, { inputEncoding: "Base64" })
          } catch (e) { }
          try {
            doc.refID = LZUTF8.decompress(doc.refID, { inputEncoding: "Base64" })
          } catch (e) { }
          doc.space = 'https://' + doc.endpoint + '/' + doc.address + '/' + doc.file
          res.send(doc)
        } else {
          res.send({ message: "Document not found", status: 404 })
        }
      } else {
        res.json({
          error: true,
          message: "Idanode not working, please retry"
        })
      }
    })
  } catch (e) {
    res.json({
      error: true,
      message: "Can't connect to wallet"
    })
  }
};