"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
import * as ipfs from '../routes/Ipfs'
require('dotenv').config()
const mongo = require('mongodb').MongoClient
var fs = require('fs')
const _ = require("underscore")

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
                        var max_opreturn = 80
                        if(process.env.MAX_OPRETURN !== undefined){
                            max_opreturn = parseInt(process.env.MAX_OPRETURN)
                        }
                        console.log('DATA TO WRITE IS ' + dataToWrite.length + ' BYTE LONG WHILE MAX IS ' + max_opreturn)
                        var write = await wallet.write(private_key, dapp_address, dataToWrite, uuid, collection, refID, protocol)
                        res.json(write)
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
        let filters = {}
        var history
        if(request['body']['protocol'] !== undefined){
            filters['protocol'] = request['body']['protocol']
        }
        if(request['body']['collection'] !== undefined){
            filters['collection'] = request['body']['collection']
        }
        if(request['body']['refID'] !== undefined){
            filters['refID'] = request['body']['refID']
        }
        if(request['body']['history'] !== undefined){
            history = request['body']['history']
        }else{
            history = false
        }

        if(request['body']['address'] !== undefined){
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let result = await db.collection('written').find({address: request['body']['address']}).sort({block: -1}).toArray()
                client.close()
                let data = await parseDB(result, filters, history)
                res.json({
                    data: data,
                    status: 200
                })
            })
        }else if(request['body']['uuid'] !== undefined){
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let result = await db.collection('written').find({uuid: request['body']['uuid']}).sort({block: -1}).toArray()
                client.close()
                let data = await parseDB(result, filters, history)
                res.json({
                    data: data,
                    status: 200
                })
            })
        }else{
            let limit = 100
            if(request['body']['limit'] !== undefined){
                limit = parseInt(request['body']['limit'])
            }
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let result = await db.collection('written').find().limit(limit).sort({block: -1}).toArray()
                client.close()
                let data = await parseDB(result, filters, history)
                res.json({
                    data: data,
                    status: 200
                })
            })
        }
    }else{
        res.json({
            data: 'Provide UUID, Address or Protocol first.',
            status: 402
        })
    }
};

async function parseDB(DB, filters = {}, history = false){
    return new Promise(async response => {
        let data = []
        let ended = []
        let uuids = []
        for(let x in DB){
            let written = DB[x]
            if(written['data'] !== undefined && written['uuid'] !== undefined && written['uuid'] !== ''){
                if(written['data'] !== 'END'){
                    if(ended.indexOf(written['uuid']) === -1){
                        if(JSON.stringify(written['data']).indexOf('ipfs:') !== -1){
                            written['is_file'] = true
                            written['data'] = written['data'].replace('ipfs:','')
                            let check = written['data'].split('***')
                            if(check[1] !== undefined && check[1] !== 'undefined'){
                                written['data'] = check[0]
                                written['title'] = check[1]
                            }
                        }else{
                            written['is_file'] = false
                        }
                        if(uuids.indexOf(written['uuid']) === -1 && written['uuid'].length > 0){
                            uuids.push(written['uuid'])
                            data.push(written)
                        }
                    }
                }else{
                    if(history === false){
                        ended.push(written['uuid'])
                    }
                }
            }
        }
        var filtered = data
        if(filtered.length > 0){
            filtered = await _.where(data, filters);
        }
        response(filtered)
    })
}

export async function received(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['address'] !== undefined){
        let filters = {}
        var history
        if(request['body']['protocol'] !== undefined){
            filters['protocol'] = request['body']['protocol']
        }
        if(request['body']['collection'] !== undefined){
            filters['collection'] = request['body']['collection']
        }
        if(request['body']['refID'] !== undefined){
            filters['refID'] = request['body']['refID']
        }
        if(request['body']['history'] !== undefined){
            history = request['body']['history']
        }else{
            history = false
        }
        mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
            const db = client.db(global['db_name'])
            let result = await db.collection('received').find({address: request['body']['address']}).sort({block: -1}).toArray()
            client.close()
            let data = await parseDB(result, filters, history)
            res.json({
                data: data,
                status: 200
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
                        while(txid.length !== 64 && error === false){
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
