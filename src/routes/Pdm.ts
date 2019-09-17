"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
import * as ipfs from '../routes/Ipfs'
require('dotenv').config()
const r = require('rethinkdb')
var fs = require('fs')

export async function write(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request !== false){
        if(request['body']['dapp_address'] !== undefined && request['body']['private_key'] !== undefined){
            if(request['body']['data'] !== undefined || request['files']['file'] !== undefined){
                var wallet = new Crypto.Wallet;
                wallet.request('validateaddress', [request['body']['dapp_address']]).then(async function(info){
                    if(info['result']['isvalid'] === true){
                        
                        var private_key = request['body']['private_key']
                        var dapp_address = request['body']['dapp_address']

                        var uuid
                        if(request['body']['uuid'] !== undefined && request['body']['uuid'] !== ''){
                            uuid = request['body']['uuid']
                        }else{
                            var Uuid = require('uuid/v4')
                            uuid = Uuid().replace(new RegExp('-', 'g'), '.')
                        }
                        
                        var collection
                        if(request['body']['collection'] !== undefined && request['body']['collection'] !== ''){
                            collection = '!*!' + request['body']['collection']
                        }else{
                            collection = '!*!'
                        }

                        var refID
                        if(request['body']['refID'] !== undefined && request['body']['refID'] !== ''){
                            refID = '!*!' + request['body']['refID']
                        }else{
                            refID = '!*!'
                        }

                        var protocol
                        if(request['body']['protocol'] !== undefined && request['body']['protocol'] !== ''){
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
                        if(dataToWrite.length <= 80){
                            let txid = ''
                            var i = 0
                            var totalfees = 0
                            var error = false
                            while(txid.length !== 64 && error == false){
                                var fees = 0.001 + (i / 1000)
                                
                                txid = <string> await wallet.send(private_key,dapp_address,dapp_address,0,dataToWrite,fees,true)
                                if(txid !== null && txid.length === 64){
                                    console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                                    totalfees += fees
                                }

                                i++;
                                if(i > 20){
                                    error = true
                                    txid = '0000000000000000000000000000000000000000000000000000000000000000'
                                }
                            }
                            if(error === false){
                                res.json({
                                    uuid: uuid,
                                    address: wallet,
                                    fees: totalfees,
                                    collection: collection.replace('!*!',''),
                                    refID: refID.replace('!*!',''),
                                    protocol: protocol.replace('!*!',''),
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
                        }else{
                            
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
                                    var prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                                } else {
                                    var sni = i + 1
                                    var startnext = sni * 74
                                    var endnext = startnext + 74
                                    var nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                                    var spi = i - 1
                                    var startprev = spi * 74
                                    var endprev = startprev + 74
                                    var prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                                }
                                chunk = prevref + chunk + nextref
                                chunks.push(chunk)
                            }

                            var totalfees = 0
                            var error = false
                            var decoded

                            for(var cix=0; cix<chunks.length; cix++){
                                var txid = ''
                                var i = 0
                                var rawtransaction
                                while(txid !== null && txid !== undefined && txid.length !== 64){
                                    var fees = 0.001 + (i / 1000)
                                    
                                    txid = <string> await wallet.send(private_key,dapp_address,dapp_address,0,chunks[cix],fees,true)
                                    if(txid !== null && txid.length === 64){
                                        console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
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
                                    address: wallet,
                                    fees: totalfees,
                                    collection: collection.replace('!*!',''),
                                    refID: refID.replace('!*!',''),
                                    protocol: protocol.replace('!*!',''),
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
                    data: 'Provide Data or file first.',
                    status: 402
                })
            }
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

export async function read(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request !== false){
        if(request['body']['address'] !== undefined){
            var conn = await r.connect({db: 'idanodejs'})
            r.table('written').getAll(request['body']['address'], {index: 'address'}).orderBy(r.desc('block')).run(conn, function(err, cursor) {
                if(err) {
                    console.log(err)
                }
            
                cursor.toArray(function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    //TODO: EXTRACT PROTOCOLS DATA
                    res.json({
                        data: result,
                        status: 200
                    })
                })
            })
        }else if(request['body']['uuid'] !== undefined){
            res.json({
                data: 'uuid',
                status: 200
            })
        }else if(request['body']['protocol'] !== undefined){
            res.json({
                data: 'protocol',
                status: 200
            })
        }else{
            res.json({
                data: 'Provide UUID, Address or Protocol first.',
                status: 402
            })
        }
    }else{
        res.json({
            data: 'Provide UUID, Address or Protocol first.',
            status: 402
        })
    }
};

export async function received(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['address'] !== undefined){
        var conn = await r.connect({db: 'idanodejs'})
        r.table('received').getAll(request['body']['address'], {index: 'address'}).orderBy(r.desc('block')).run(conn, function(err, cursor) {
            if(err) {
                console.log(err)
            }
        
            cursor.toArray(function(err, result) {
                if(err) {
                    console.log(err)
                }
                res.json({
                    data: result,
                    status: 200
                })
            })
        })
    }else{
        res.json({
            data: 'Provide address first.',
            status: 402
        })
    }
};

export async function invalidate(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request !== false){
        if(request['body']['dapp_address'] !== undefined && request['body']['private_key'] !== undefined){
            if(request['body']['data'] !== undefined || request['files']['file'] !== undefined){
                var wallet = new Crypto.Wallet;
                wallet.request('validateaddress', [request['body']['dapp_address']]).then(async function(info){
                    if(info['result']['isvalid'] === true){
                        
                        var private_key = request['body']['private_key']
                        var dapp_address = request['body']['dapp_address']

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
                            while(txid.length !== 64 && error == false){
                                var fees = 0.001 + (i / 1000)
                                txid = <string> await wallet.send(private_key,dapp_address,dapp_address,0,dataToWrite,fees)
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
                                    address: wallet,
                                    fees: totalfees,
                                    success: true,
                                    txs: [txid]
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
                    data: 'Provide Data or file first.',
                    status: 402
                })
            }
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


