import express = require("express")
import * as Utilities from '../libs/Utilities'
import * as Crypto from '../libs/Crypto'
import { type } from "os";

export function info(req: express.Request, res: express.Response) {
    res.json({status: "ONLINE"})
};

export function gettransaction(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var txid = req.params.txid
    wallet.request('getrawtransaction', [txid]).then(function(rawtransaction){
        wallet.request('decoderawransaction', [txid]).then(function(rawtransaction){
            wallet.analyzeTransaction(rawtransaction['result']).then(response => {
                res.json({
                    data: response,
                    status: 200
                })
            })
        })
    })
};

export function getblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var block = req.params.block
    wallet.request('getblockhash', [parseInt(block)]).then(function(blockhash){
        wallet.analyzeBlock(blockhash['result']).then(response => {
            res.json({
                data: response,
                status: 200
            })
        })
    })
};

export async function transactions(req: express.Request, res: express.Response) {
    var address = req.params.address
    
    var list = []
    var transactions = [] //read transactions
    for(var index in list){
        var tx = JSON.parse(list[index])
        transactions.push(tx)
    }
    transactions.sort((a, b) => Number(b.time) - Number(a.time));        
    res.json({
        data: transactions,
        status: 200
    })
};

export async function unspent(req: express.Request, res: express.Response) {
    var address = req.params.address
    var wallet = new Crypto.Wallet
    var balance = 0
    
    wallet.request('listunspent',[0,9999999,[address]]).then(response => {
        var unspent = response['result']
        for(var i = 0; i < unspent.length; i++){
            balance += unspent[i].amount
        }
        res.json({
            balance: balance,
            unspent: unspent,
            status: 200
        })
    })
};

export async function balance(req: express.Request, res: express.Response) {
    var address = req.params.address
        var balance = 0
        var list = [] //read transactions
        for(var index in list){
            var tx = JSON.parse(list[index])
            balance += tx.value
        }
        res.json({
            balance: balance,
            status: 200
        })
   
};

export async function stats(req: express.Request, res: express.Response) {
    var address = req.params.address
    if(address.length > 0){
        var received = 0
        var sent = 0
        var balance = 0
        var stats = {
            rewards: {
                count: 0,
                amount: 0,
                stats: {},
                txns: []
            },
            stake: {
                count: 0,
                amount: 0,
                stats: {},
                txns: []
            }
        }
        var list = [] //read transactions
        var transactions = []
        for(var index in list){
            var unordered = JSON.parse(list[index])
            transactions.push(unordered)
        }
        transactions.sort((a, b) => Number(a.time) - Number(b.time));        
        for(var index in transactions){
            var tx = transactions[index]
            
            if(tx.value > 0){
                received += tx.value
            }else{
                sent += tx.value
            }
            balance += tx.value
            var datetime = new Date(tx.time * 1000);
            var date = datetime.getFullYear()+ '-' + ('0' + (datetime.getMonth()+1)).slice(-2) + '-' + ('0' + datetime.getDate()).slice(-2);
            

            if(tx.type === 'STAKE'){
                stats.stake.count++
                stats.stake.amount += tx.value
                stats.stake.txns.push(tx)

                if(stats.stake.stats[date] === undefined){
                    stats.stake.stats[date] = 0
                }
                stats.stake.stats[date] += tx.value
            }

            if(tx.type === 'REWARD'){
                stats.rewards.count++
                stats.rewards.amount += tx.value
                stats.rewards.txns.push(tx)

                if(stats.rewards.stats[date] === undefined){
                    stats.rewards.stats[date] = 0
                }
                stats.rewards.stats[date] += tx.value
            }
        }
        
        sent = sent * -1

        res.json({
            balance: balance,
            received: received, 
            sent: sent,
            rewards: stats.rewards,
            stake: stats.stake,
            status: 200
        })
        
    }else{
        res.json({
            data: 'Missing parameter: address',
            status: 422
        })
    }
};
