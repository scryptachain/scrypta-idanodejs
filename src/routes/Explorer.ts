import express = require("express")
import * as Crypto from '../libs/Crypto'
const mongo = require('mongodb').MongoClient

export function info(req: express.Request, res: express.Response) {
    res.json({ status: "ONLINE" })
};

export function getblockhash(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var block = req.params.index
    wallet.request('getblockhash', [parseInt(block)]).then(function (response) {
        res.json({
            index: block,
            hash: response['result'],
            status: 200
        })
    })
};

export function getrawblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var hash = req.params.hash
    wallet.request('getblock', [hash]).then(async function (response) {
        let tx = response['result']['tx']
        if (tx !== undefined) {
            let txs = []
            for (let k in tx) {
                let rawtransaction = await wallet.request('getrawtransaction', [tx[k], 1])
                txs.push({
                    hash: rawtransaction['result'].txid,
                    inputs: rawtransaction['result'].vin,
                    outputs: rawtransaction['result'].vout,
                    time: rawtransaction['result'].time,
                    blockhash: rawtransaction['result'].blockhash
                })
            }
            response['result'].txs = txs
        }
        res.json({
            data: response['result'],
            status: 200
        })
    })
};

export async function getrawtransaction(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var txid = req.params.txid
    let rawtransaction = await wallet.request('getrawtransaction', [txid, 1])
    if (rawtransaction['result'] !== undefined && rawtransaction['result'] !== null) {
        res.json({
            hash: rawtransaction['result'].txid,
            inputs: rawtransaction['result'].vin,
            outputs: rawtransaction['result'].vout,
            time: rawtransaction['result'].time,
            blockhash: rawtransaction['result'].blockhash
        })
    } else {
        res.json(false)
    }
};

export function analyzeblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var block = req.params.block
    wallet.request('getblockhash', [parseInt(block)]).then(function (blockhash) {
        wallet.analyzeBlock(blockhash['result']).then(analyzed => {
            res.json({
                data: analyzed,
                status: 200
            })
        })
    })
};

export function getutxo(req: express.Request, res: express.Response) {
    var txid = req.params.txid
    var vout = req.params.vout
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let utxo = await db.collection('unspent').findOne({ txid: txid, vout: parseInt(vout) })
        console.log(utxo)
        if (utxo !== null) {
            res.json(utxo)
        } else {
            res.json(false)
        }
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

export function getlastblock(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then(info => {
        if (info['result'] !== undefined && info['result'].blocks !== undefined) {
            var block = info['result'].blocks
            wallet.request('getblockhash', [block]).then(function (blockhash) {
                wallet.analyzeBlock(blockhash['result']).then(response => {
                    res.json({
                        data: response,
                        status: 200
                    })
                })
            })
        } else {
            res.json(false)
        }
    })
};

export async function transactions(req: express.Request, res: express.Response) {
    var address = req.params.address
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let transactions = await db.collection('transactions').find({ address: address }).sort({ blockheight: -1 }).toArray()
        let response = []
        let unconfirmed = []
        for (let x in transactions) {
            let tx = transactions[x]
            if (tx['blockheight'] !== null) {
                response.push(tx)
            } else {
                unconfirmed.push(tx)
            }
        }
        client.close()
        res.json({
            data: response,
            unconfirmed: unconfirmed,
            status: 200
        })
    })
};

export async function unspent(req: express.Request, res: express.Response) {
    var address = req.params.address
    var balance = 0
    var wallet = new Crypto.Wallet;
    wallet.request('masternode', ['list']).then(async function (list) {
        let masternodes = list['result']
        let masternodetxs = []
        for (let k in masternodes) {
            let mn = masternodes[k]
            masternodetxs.push(mn['txhash'] + ':' + mn['outidx'])
        }
        var wallet = new Crypto.Wallet
        let unspent = []
        for (let i in global['utxocache']) {
            unspent.push(global['utxocache'][i])
            balance += global['utxocache'][i].amount
        }
        let locked = []
        let blockchainunspent = await wallet.listunpent(address)
        for (let i in blockchainunspent) {
            balance += blockchainunspent[i].amount
            if (masternodetxs.indexOf(blockchainunspent[i].txid + ':' + blockchainunspent[i].vout) !== -1) {
                locked.push(blockchainunspent[i])
            } else {
                unspent.push(blockchainunspent[i])
            }
        }
        res.json({
            balance: balance,
            unspent: unspent,
            locked: locked,
            status: 200
        })
    })
};

export async function balance(req: express.Request, res: express.Response) {
    var address = req.params.address
    var balance = 0
    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
        const db = client.db(global['db_name'])
        let transactions = await db.collection('transactions').find({ address: address }).sort({ blockheight: -1 }).toArray()
        for (var index in transactions) {
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

export async function validate(req: express.Request, res: express.Response) {
    var address = req.params.address
    var wallet = new Crypto.Wallet;
    wallet.request('validateaddress', [address]).then(function (validation) {
        res.json({
            data: validation['result'],
            status: 200
        })
    })
};

export async function stats(req: express.Request, res: express.Response) {
    var address = req.params.address
    if (address.length > 0) {
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
        mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
            const db = client.db(global['db_name'])
            let transactions = await db.collection('transactions').find({ address: address }).sort({ blockheight: -1 }).toArray()
            for (var index in transactions) {
                var tx = transactions[index]

                if (tx.value > 0) {
                    received += tx.value
                } else {
                    sent += tx.value
                }
                balance += tx.value
                var datetime = new Date(tx.time * 1000);
                var date = datetime.getFullYear() + '-' + ('0' + (datetime.getMonth() + 1)).slice(-2) + '-' + ('0' + datetime.getDate()).slice(-2);


                if (tx.type === 'STAKE') {
                    stats.stake.count++
                    stats.stake.amount += tx.value
                    stats.stake.txns.push(tx)

                    if (stats.stake.stats[date] === undefined) {
                        stats.stake.stats[date] = 0
                    }
                    stats.stake.stats[date] += tx.value
                }

                if (tx.type === 'REWARD') {
                    stats.rewards.count++
                    stats.rewards.amount += tx.value
                    stats.rewards.txns.push(tx)

                    if (stats.rewards.stats[date] === undefined) {
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
    } else {
        res.json({
            data: 'Missing parameter: address',
            status: 422
        })
    }
};

export async function networkstats(req: express.Request, res: express.Response) {
    var totaladdresses = 0
    var totalunspent = 0
    var active24h = 0
    var writtendata24h = 0
    var writtendatatotal = 0
    var planumtxs24h = 0
    var planumtxstotal = 0
    try {
        mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
            const db = client.db(global['db_name'])
            let transactions = await db.collection('transactions').find().sort({ blockheight: -1 }).toArray()

            client.close()
            res.json({
                totaladdresses: totaladdresses,
                totalunspent: totalunspent,
                active24h: active24h,
                writtendata24h: writtendata24h,
                writtendatatotal: writtendatatotal,
                planumtxs24h: planumtxs24h,
                planumtxstotal: planumtxstotal
            })
        })
    } catch (e) {
        res.json({
            error: true,
            message: "Can't fetch data"
        })
    }
};
