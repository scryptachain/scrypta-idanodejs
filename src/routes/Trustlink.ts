"use strict";
import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
require('dotenv').config()
const r = require('rethinkdb')

export async function init(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var parser = new Utilities.Parser
    var request = await parser.body(req)

    if(request['body']['addresses'] !== undefined){
        var addresses = request['body']['addresses'].split(',')
        if(addresses.length > 0){
            wallet.request('createmultisig',[addresses.length, addresses]).then(async function(init){
                var trustlink = init['result'].address
                var txid
                wallet.request('importaddress',[trustlink,"",false]).then(async function(result){
                    var airdrop = (request['body']['airdrop'] === 'true' || request['body']['airdrop'] === true)
                    if(request['body']['airdrop'] !== undefined && airdrop === true){
                        var wallet = new Crypto.Wallet;
                        var balance = await wallet.request('getbalance')
                        var airdrop_value = parseFloat(process.env.AIRDROP)
                        if(balance['result'] > airdrop_value){
                            var airdrop_tx = await wallet.request('sendtoaddress',[trustlink,airdrop_value])
                            txid = airdrop_tx['result']
                            trustlink['airdrop'] = txid
                        }else{
                            trustlink['airdrop'] = false
                            console.log('Balance insufficient for airdrop')
                        }
                    }
                    res.json({
                        data: init['result'],
                        status: 200
                    })
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

}

export async function send(req: express.Request, res: express.Response) {

}

export async function invalidate(req: express.Request, res: express.Response) {

}