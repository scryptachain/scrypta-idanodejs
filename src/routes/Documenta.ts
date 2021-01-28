import express = require("express")
const ft = require('file-type')
var fs = require('fs')
var formidable = require('formidable')
import * as Space from '../libs/Space'
import * as Crypto from '../libs/Crypto'
const crypto = require('crypto')
const LZUTF8 = require('lzutf8')
import { v4 as uuidv4 } from 'uuid'

export async function add(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  form.maxFileSize = global['limit'] * 1024 * 1024
  form.maxFieldsSize = global['limit'] * 1024 * 1024
  form.multiples = true
  if (req.body.signature !== undefined && req.body.message !== undefined && req.body.pubkey !== undefined) {
    let space = new Space.syncer
    var wallet = new Crypto.Wallet;
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
    }
  } else {
    res.send({
      data: {
        error: "Specify hexed buffer and signed message first."
      },
      status: 422
    })
  }
};

export async function get(req: express.Request, res: express.Response) {
  // GET FILE FROM SPACE OR LINKED SPACES
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