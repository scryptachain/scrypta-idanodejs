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