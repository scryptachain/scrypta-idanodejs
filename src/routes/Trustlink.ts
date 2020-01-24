"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
import * as ipfs from '../routes/Ipfs'
require('dotenv').config()

export async function init(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var parser = new Utilities.Parser
    var request = await parser.body(req)

    if(request['body']['addresses'] !== undefined){
        var addresses = request['body']['addresses'].split(',')
        if(addresses.length > 0){
            addresses.sort()
            wallet.request('createmultisig',[addresses.length, addresses]).then(async function(init){
                var trustlink = init['result'].address
                var txid
                var airdrop = (request['body']['airdrop'] === 'true' || request['body']['airdrop'] === true)
                if(request['body']['airdrop'] !== undefined && airdrop === true){
                    var wallet = new Crypto.Wallet;
                    var balance = await wallet.request('getbalance')
                    var airdrop_value = parseFloat(process.env.AIRDROP)
                    if(balance['result'] > airdrop_value){
                        var airdrop_tx = await wallet.request('sendtoaddress',[trustlink,airdrop_value])
                        txid = airdrop_tx['result']
                        init['airdrop'] = txid
                    }else{
                        init['airdrop'] = false
                        console.log('Balance insufficient for airdrop')
                    }
                }
                res.json({
                    data: init['result'],
                    status: 200
                })
            })
        }else{
            res.json({
                data: 'Provide two or more addresses first. ' + addresses.length + ' provided.',
                status: 402
            })
        }
    }else{
        res.json({
            data: 'Provide two or more addresses first.',
            status: 402
        })
    }
}

export async function write(req: express.Request, res: express.Response) {
  var wallet = new Crypto.Wallet;
  var parser = new Utilities.Parser
  var request = await parser.body(req)
  if(request !== false){
    if(request['body']['trustlink'] !== undefined && request['body']['private_keys'] !== undefined && request['body']['redeemScript'] !== undefined){
      if(request['body']['data'] !== undefined || request['files']['file'] !== undefined){
        wallet.request('validateaddress', [request['body']['trustlink']]).then(async function(info){
            if(info['result']['isvalid'] === true){
              var private_keys = request['body']['private_keys']
              var trustlink = request['body']['trustlink']
              var redeemScript = request['body']['redeemScript']

              var uuid
              if(request['body']['uuid'] !== undefined && request['body']['uuid'] !== ''){
                  uuid = request['body']['uuid']
              }else{
                  var Uuid = require('uuid/v4')
                  uuid = Uuid().replace(new RegExp('-', 'g'), '.')
              }

              var collection
              if(request['body']['collection'] !== undefined && request['body']['collection'] !== '' && request['body']['collection'] !== 'undefined'){
                  collection = '!*!' + request['body']['collection']
              }else{
                  collection = '!*!'
              }

              var refID
              if(request['body']['refID'] !== undefined && request['body']['refID'] !== '' && request['body']['refID'] !== 'undefined'){
                  refID = '!*!' + request['body']['refID']
              }else{
                  refID = '!*!'
              }

              var protocol
              if(request['body']['protocol'] !== undefined && request['body']['protocol'] !== '' && request['body']['protocol'] !== 'undefined'){
                  protocol = '!*!' + request['body']['protocol']
              }else{
                  protocol = '!*!'
              }

              var metadata
              //TODO: ADD FOLDER, NOT ONLY SINGLE FILES
              if(request['files']['file'] !== undefined){
                  metadata = 'ipfs:'
                  var path = request['files']['file'].path
                  var hash = await ipfs.addfile(path).catch(err =>{
                      console.log(err)
                  })
                  metadata += hash
                  if(request['body']['data'] !== undefined && request['body']['data'].length > 0){
                      metadata += '***' + request['body']['data']
                  }
              }else{
                  metadata = request['body']['data']
              }
              var dataToWrite = '*!*' + uuid+collection+refID+protocol+ '*=>' + metadata + '*!*'
              console.log('\x1b[33m%s\x1b[0m', 'RECEIVED DATA TO WRITE ' + dataToWrite)

              let write = await wallet.writemultisig(private_keys, trustlink, redeemScript, dataToWrite, uuid, collection, refID, protocol)
              res.json(write)
              
            }else{
              res.json({
                  data: 'Trustlink isn\'t valid.',
                  status: 402,
                  result: info['result']
              })
            }
        })
      }else{
        res.json({
            data: 'Provide Data or file first.',
            status: 402
        })
      }
    }else{
      res.json({
          data: 'Provide Trustlink, Private Keys and ReedemScript first.',
          status: 402
      })
    }
  }else{
    res.json({
        data: 'Make a request first.',
        status: 402
    })
  }
}

export async function send(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['trustlink'] !== undefined && request['body']['to'] !== undefined && request['body']['private_keys'] !== undefined && request['body']['redeemScript'] !== undefined){
        var to = request['body']['to']
        var amount = parseFloat(request['body']['amount'])
        var private_keys = request['body']['private_keys']
        var trustlink = request['body']['trustlink']
        var redeemScript = request['body']['redeemScript']

        var dataToWrite
        if(request['body']['message'] !== undefined){
            dataToWrite = request['body']['message']
        }

        wallet.request('validateaddress',[trustlink]).then(async response => {
            var validation = response['result']
            if(validation.isvalid === true){
                wallet.request('validateaddress',[to]).then(async response => {
                    var validation = response['result']
                    if(validation.isvalid === true){
                        if(amount > 0){
                            var i = 0
                            var totalfees = 0
                            var error = false
                            var txid = ''
                            while(txid.length !== 64 && error == false){
                                var fees = 0.001 + (i / 1000)
                                txid = <string> await wallet.sendmultisig(private_keys,trustlink,to,amount,dataToWrite,redeemScript,fees,true)

                                if(txid !== null && txid.length === 64){
                                    console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                                    totalfees += fees
                                }else{
                                  console.log('TX FAILED.')
                                }

                                i++;
                                if(i > 20){
                                    error = true
                                    txid = '0000000000000000000000000000000000000000000000000000000000000000'
                                }
                            }
                            if(error === false){
                                res.json({
                                    success: true,
                                    fees: totalfees,
                                    txid: txid
                                })
                            }else{
                                res.json({
                                    data: 'Can\'t send coins.',
                                    status: 501
                                })
                            }
                        }else{
                            res.json({
                                data: 'Amount must be grater than zero.',
                                status: 402
                            })
                        }
                    }else{
                        res.json({
                            data: 'Receiving address is invalid.',
                            status: 402
                        })
                    }
                })
            }else{
                res.json({
                    data: 'Sending address is invalid.',
                    status: 402
                })
            }
        })
    }else{
        res.json({
            data: 'Provide from, to, amount and private key first.',
            status: 402
        })
    }
}

export async function invalidate(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request !== false){
        if(request['body']['trustlink'] !== undefined && request['body']['private_keys'] !== undefined && request['body']['redeemScript'] !== undefined){
            var wallet = new Crypto.Wallet;
            wallet.request('validateaddress', [request['body']['trustlink']]).then(async function(info){
                if(info['result']['isvalid'] === true){

                    var private_keys = request['body']['private_keys']
                    var trustlink = request['body']['trustlink']
                    var redeemScript = request['body']['redeemScript']

                    var uuid
                    if(request['body']['uuid'] !== undefined && request['body']['uuid'] !== ''){
                        uuid = request['body']['uuid']

                        var metadata = 'END'

                        var dataToWrite = '*!*' + uuid + '*=>' + metadata + '*!*'
                        console.log('\x1b[33m%s\x1b[0m', 'RECEIVED DATA TO INVALIDATE ' + uuid)

                        let txid = ''
                        var i = 0
                        var totalfees = 0
                        var error = false
                        while(txid.length !== 64 && error === false){
                            var fees = 0.001 + (i / 1000)
                            txid = <string> await wallet.sendmultisig(private_keys,trustlink,trustlink,0,dataToWrite,redeemScript,fees,true)
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
                                fees: totalfees,
                                success: true,
                                txid: txid
                            })
                        }else{
                            res.json({
                                data: 'Can\'t write data.',
                                status: 501
                            })
                        }
                    }else{
                        res.json({
                            data: 'Provide UUID first.',
                            status: 402,
                            result: info['result']
                        })
                    }
                }else{
                    res.json({
                        data: 'Address isn\'t valid.',
                        status: 402,
                        result: info['result']
                    })
                }
            })
        }else{
            res.json({
                data: 'Provide Address, Private Key first.',
                status: 402
            })
        }
    }else{
        res.json({
            data: 'Make a request first.',
            status: 402
        })
    }
}
