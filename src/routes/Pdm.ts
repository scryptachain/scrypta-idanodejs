"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
import Trx from '../libs/trx/trx.js'
import { ifError } from "assert";
require('dotenv').config()
const r = require('rethinkdb')

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

                        var Uuid = require('uuid/v4')
                        var uuid = Uuid().replace(new RegExp('-', 'g'), '.')
                        
                        var collection
                        if(request['body']['collection'] !== undefined && request['body']['collection'] !== ''){
                            collection = '!*!' + collection
                        }else{
                            collection = '!*!'
                        }

                        var refID
                        if(request['body']['refID'] !== undefined && request['body']['refID'] !== ''){
                            refID = '!*!' + refID
                        }else{
                            refID = '!*!'
                        }

                        var protocol
                        if(request['body']['protocol'] !== undefined && request['body']['protocol'] !== ''){
                            protocol = '!*!' + protocol
                        }else{
                            protocol = '!*!'
                        }

                        var metadata = request['body']['data']
                        var dataToWrite = '*!*' + uuid+collection+refID+protocol+ '*=>' + metadata + '*!*'

                        if(dataToWrite.length <= 80){
                            var txid
                            var i = 0
                            var totalfees = 0
                            while(txid !== false && txid.length !== 64){
                                var fees = 0.001 + (i / 1000)
                                txid = await wallet.send(private_key,true,dapp_address,0,dataToWrite,fees)
                                if(txid !== false && txid.length === 64){
                                    totalfees += fees
                                }
                                i++;
                            }
                            
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
                            for(var cix=0; cix<chunks.length; cix++){
                                var txid
                                var i = 0
                                while(txid.length !== 64){
                                    var fees = 0.001 + (i / 1000)
                                    txid = await wallet.send(private_key,true,dapp_address,0,chunks[cix],fees)
                                    if(txid !== false && txid.length === 64){
                                        totalfees += fees
                                        txs.push(txid)
                                    }
                                    i++;
                                }
                            }

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
        if(request['address'] !== undefined){
            var conn = await r.connect({db: 'idanodejs'})
            r.table('written').getAll(request['address'], {index: 'address'}).orderBy(r.desc('block')).run(conn, function(err, cursor) {
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
        }else if(request['uuid'] !== undefined){
            res.json({
                data: 'uuid',
                status: 200
            })
        }else if(request['protocol'] !== undefined){
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

export function received(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then(function(info){
        res.json(info['result'])
    })
};

export function invalidate(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then(function(info){
        res.json(info['result'])
    })
};

export function daemon(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then(function(info){
        res.json(info['result'])
    })
};

