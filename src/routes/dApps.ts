import express = require("express")
const fileType = require('file-type')
var fs = require('fs')
var formidable = require('formidable')
import * as Crypto from '../libs/Crypto'

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
                    let txid = ''
                    var i = 0
                    var totalfees = 0
                    var error = false
                    while(txid.length !== 64 && error == false){
                        var fees = 0.001 + (i / 1000)
                        var wallet = new Crypto.Wallet;
                        var Uuid = require('uuid/v4')
                        var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
                        var dataToWrite = '*!*' + uuid+'!*!'+'!*!'+'!*!dapp://'+ '*=>' + hash['hash'] + '*!*'
                        txid = <string> await wallet.send(fields.private_key,fields.dapp_address,fields.dapp_address,0,dataToWrite,fees)
                        console.log('SEND SUCCESS, TXID IS: ' + txid  + '. FEES ARE: ' + fees + 'LYRA')
                        if(txid.length === 64){
                            totalfees += fees
                        }
                        i++;
                        if(i > 20){
                            error = true
                        }
                    }
                    if(error === false){
                        res.json({
                            uuid: uuid,
                            address: fields.dapp_address,
                            fees: totalfees,
                            collection: '',
                            refID: '',
                            protocol: 'dapp://',
                            dimension: dataToWrite.length,
                            chunks: 1,
                            stored: dataToWrite,
                            txs: [txid]
                        })
                    }else{
                        res.json({
                            data: 'Can\'t write data.',
                            status: 501
                        })
                    }
                    res.send({
                        data: hash,
                        status: 200
                    })
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