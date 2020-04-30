import express = require("express")
const fileType = require('file-type')
var fs = require('fs')
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'
import { v4 as uuidv4 } from 'uuid';

export function upload(req: express.Request, res: express.Response) {
    var form = new formidable.IncomingForm();
    form.multiples = true
    form.parse(req, function(err, fields, files) {
      if(files.files !== undefined){
        if(fields.dapp_address !== undefined){
          var ipfscontents = new Array()
          for(var k in files.files){
            var file = fs.readFileSync(files.files[k].path)
            var ipfsobj = {
              path: fields.dapp_address + '/' + files.files[k].name,
              content: file
            }
            ipfscontents.push(ipfsobj)
          }
          global['ipfs'].add(ipfscontents).then(async results => {
            for(var x in results){
                var hash = results[x]
                if(hash['path'] === fields.dapp_address){
                  var i = 0
                  var totalfees = 0
                  var error = false
                  var wallet = new Crypto.Wallet;
                  var uuid = uuidv4().replace(new RegExp('-', 'g'), '.')
                  var dataToWrite = '*!*' + uuid+'!*!'+'!*!'+'!*!dapp://'+ '*=>' + hash['hash'] + '*!*'
                  let write = await wallet.write(fields.private_key, fields.dapp_address, dataToWrite, uuid, '', '', 'dapp://')
                  res.json(write)
                }
            }
          })
        }else{
          res.send({
            data: {
              error: "Specify dApp address first."
            },
            status: 422
          })
        }
      }else{
        res.send({
            data: {
              error: "You must upload the entire dApp folder first."
            },
            status: 422
          })
      }
    })
};

export function serve(req: express.Request, res: express.Response) {
    //TODO: copy code from scrypta-dapps-engine
};

export function run(req: express.Request, res: express.Response) {
  //TODO: load VM package and start trustless code (JS)
};