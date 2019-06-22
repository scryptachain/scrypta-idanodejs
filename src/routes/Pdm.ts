"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
import Trx from '../libs/trx/trx.js'
require('dotenv').config()
const r = require('rethinkdb')

export async function write(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request !== false){
        if(request['address'] !== undefined && request['private_key'] === undefined){
            var wallet = new Crypto.Wallet;
            wallet.request('validateaddress', [request['address']]).then(function(info){
                if(info['result']['is_mine'] === true){
                    
                }else{
                    res.json({
                        data: 'Address isn\'t in the wallet.',
                        status: 402
                    })
                }
            })
        }else{
            
        }
    }else{
        res.json({
            data: 'Provide Address and Metadata first.',
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

