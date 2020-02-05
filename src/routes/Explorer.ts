import express = require("express")
import * as Utilities from '../libs/Utilities'
import * as Daemon from '../libs/Daemon'
import * as Crypto from '../libs/Crypto'
const mongo = require('mongodb').MongoClient
var watchlist = []

export function info(req: express.Request, res: express.Response) {
    res.json({status: "ONLINE"})
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

export function analyzeblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var block = req.params.block
    wallet.request('getblockhash', [parseInt(block)]).then(function(blockhash){
        wallet.analyzeBlock(blockhash['result']).then(analyzed => {
            res.json({
                data: analyzed,
                status: 200
            })
        })
    })
};

export function analyzemempool(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.analyzeMempool().then(analyzed => {
        res.json({
            data: analyzed,
            status: 200
        })
    })
};

export function cleanmempool(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.cleanMempool().then(response => {
        res.json({
            cleaned: response,
            status: 200
        })
    })
};

export function resync(req: express.Request, res: express.Response) {
    var block = req.params.block
    global['syncLock'] = true 
    clearTimeout(global['syncTimeout'])
    mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
        const db = client.db(global['db_name'])
        
        let sc_unspent = await db.collection('sc_unspent').find().sort({block: 1}).toArray(1)
        for(let x in sc_unspent){
            if(sc_unspent[x].block > block){
                await db.collection('sc_unspent').deleteOne({"_id": sc_unspent[x]._id})
            }
        }
        let sc_transactions = await db.collection('sc_transactions').find().sort({block: 1}).toArray(1)
        for(let x in sc_transactions){
            if(sc_transactions[x].block > block){
                await db.collection('sc_transactions').deleteOne({"_id": sc_transactions[x]._id})
            }
        }
        let written = await db.collection('written').find().sort({block: 1}).toArray(1)
        for(let x in written){
            if(written[x].block > block){
                await db.collection('written').deleteOne({"_id": written[x]._id})
            }
        }
        let received = await db.collection('received').find().sort({block: 1}).toArray(1)
        for(let x in received){
            if(received[x].block > block){
                await db.collection('received').deleteOne({"_id": received[x]._id})
            }
        }
        setTimeout(function(){
            global['syncLock'] = false
            var daemon = new Daemon.Sync
            daemon.analyze(parseInt(block))

            res.json({
                staus: 'Resync started from ' + parseInt(block),
                status: 200
            })
        },200)
    })
};


export function getlastblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then(info => {
        var block = info['result'].blocks

        wallet.request('getblockhash', [block]).then(function(blockhash){
            wallet.analyzeBlock(blockhash['result']).then(response => {
              res.json({
                data: response,
                status: 200
              })
            })
        })
    })
};

export async function transactions(req: express.Request, res: express.Response) {
    var address = req.params.address
    mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
        const db = client.db(global['db_name'])
        let transactions = await db.collection('transactions').find({address: address}).sort({blockheight: -1}).toArray()
        client.close()
        res.json({
            data: transactions,
            status: 200
        })
    })
};

export async function unspent(req: express.Request, res: express.Response) {
    var address = req.params.address
    var balance = 0
    var wallet = new Crypto.Wallet
    let unspent = []
    for(let i in global['utxocache']){
        unspent.push(global['utxocache'][i])
        balance +=  global['utxocache'][i].amount
    }
    let blockchainunspent = await wallet.listunpent(address)
    for(let i in blockchainunspent){
        unspent.push(blockchainunspent[i])
        balance += blockchainunspent[i].amount
    }
    res.json({
        balance: balance,
        unspent: unspent,
        status: 200
    })
};

export async function balance(req: express.Request, res: express.Response) {
    var address = req.params.address
    var balance = 0
    mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
        const db = client.db(global['db_name'])
        let transactions = await db.collection('transactions').find({address: address}).sort({blockheight: -1}).toArray()
        for(var index in transactions){
            var tx = transactions[index]
            balance += parseFloat(tx.value.toFixed(8))
        }
        client.close()
        res.json({
            balance: parseFloat(balance.toFixed(8)),
            status: 200
        })
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
        mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
            const db = client.db(global['db_name'])
            let transactions = await db.collection('transactions').find({address: address}).sort({blockheight: -1}).toArray()
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

            client.close()
            res.json({
                balance: balance,
                received: received,
                sent: sent,
                rewards: stats.rewards,
                stake: stats.stake,
                status: 200
            })
        })
    }else{
        res.json({
            data: 'Missing parameter: address',
            status: 422
        })
    }
};
