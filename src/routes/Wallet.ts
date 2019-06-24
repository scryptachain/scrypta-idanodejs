import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
const {promisify} = require('util')

export async function getinfo(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var lastindexed = "0"

    wallet.request('getinfo').then(function(info){
        info['result']['indexed'] = parseInt(lastindexed)
        var toindex = parseInt(info['result']['blocks']) - parseInt(lastindexed)
        res.json(info['result'])
    })
};

export async function getmasternodelist(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;

    wallet.request('masternode',['count']).then(function(count){
        wallet.request('masternode',['list']).then(function(list){
            wallet.request('masternode',['current']).then(function(current){
                var response = {
                    count: count['result'],
                    current: current['result'],
                    list: list['result']
                }
                res.json(response)
            })
        })
    })
};

export async function init(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['address'] !== undefined){
        wallet.request('importaddress',[request['body']['address'], request['body']['address'], false]).then(async function(result){
            var txid
            var airdrop = (request['body']['airdrop'] === 'true' || request['body']['airdrop'] === true)
            if(request['body']['airdrop'] !== undefined && airdrop === true){
                var wallet = new Crypto.Wallet;
                var balance = await wallet.request('getbalance')
                var airdrop_value = parseFloat(process.env.AIRDROP)
                if(balance['result'] > airdrop_value){
                    var airdrop_tx = await wallet.request('sendtoaddress',[request['body']['address'],airdrop_value])
                    txid = airdrop_tx['result']
                }else{
                    console.log('Balance insufficient for airdrop')
                }
            }
            res.json({
                data: {
                    dapp_address: request['body']['address'],
                    airdrop_tx: txid
                },
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

export async function listunspent(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
   
};

export async function sendrawtransaction(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
   
};