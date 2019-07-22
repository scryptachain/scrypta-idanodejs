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
                    var i = 0
                    var totalfees = 0
                    var error = false
                    var wallet = new Crypto.Wallet;
                    var Uuid = require('uuid/v4')
                    var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
                    var dataToWrite = '*!*' + uuid+'!*!'+'!*!'+'!*!dapp://'+ '*=>' + hash['hash'] + '*!*'
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
                            var prevref = dataToWrite.substr(startprev,endprev).substr(71)
                        } else {
                            var startnext = (i + 1) * 74
                            var endnext = startnext + 74
                            var nextref = dataToWrite.substring(startnext,endnext).substring(0,3)

                            var startprev = (i - 1) * 74
                            var endprev = startprev + 74
                            var prevref = dataToWrite.substr(startprev,endprev).substr(71)
                        }
                        chunk = prevref + chunk + nextref
                        chunks.push(chunk)
                    }

                    var totalfees = 0
                    var error = false

                    for(var cix=0; cix<chunks.length; cix++){
                        var txid = ''
                        var i = 0
                        while(txid.length !== 64){
                            var fees = 0.001 + (i / 1000)
                            txid = <string> await wallet.send(fields.private_key,fields.dapp_address,fields.dapp_address,0,chunks[cix],fees)
                            console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                            if(txid.length === 64){
                                totalfees += fees
                                txs.push(txid)
                            }
                            i++;
                            if(i > 20){
                                error = true
                                txid = '0000000000000000000000000000000000000000000000000000000000000000'
                            }
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
                            chunks: nchunks,
                            stored: dataToWrite,
                            txs: txs
                        })
                    }else{
                        res.json({
                            data: 'Can\'t write data.',
                            status: 501
                        })
                    }
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