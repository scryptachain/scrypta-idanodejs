import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'
const mongo = require('mongodb').MongoClient
var CoinKey = require('coinkey')

export async function getinfo(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
        const db = client.db(global['db_name'])
        let result = await db.collection('settings').find({setting: 'sync'}).toArray()
        client.close()
        var lastindexed = "0"
        if(result[0].value !== undefined){
            lastindexed = result[0].value
        }

        wallet.request('getinfo').then(function(info){
            if(info['result'] !== undefined && info['result'] !== null){
                info['result']['indexed'] = parseInt(lastindexed)
                var toindex = parseInt(info['result']['blocks']) - parseInt(lastindexed)
                info['result']['toindex'] = toindex
                res.json(info['result'])
            }
        })
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

export async function decoderawtransaction(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['rawtransaction'] !== undefined){
        wallet.request('decoderawtransaction',[request['body']['rawtransaction']]).then(function(decoded){
            res.json({
                transaction: decoded['result'],
                status: 200
            })
        })
    }else{
        res.json({
            data: 'Provide raw transaction (hex) first.',
            status: 402
        })
    }
};

export async function getnewaddress(req: express.Request, res: express.Response) {

    var internal = req.params.internal
    if(internal === undefined){
        var ck = new CoinKey.createRandom(global['lyraInfo'])
        var lyrapub = ck.publicAddress;
        var lyraprv = ck.privateWif;
        var lyrakey = ck.publicKey.toString('hex');

        res.json({
            address: lyrapub,
            private_key: lyraprv,
            pub_key: lyrakey,
            status: 200
        })

    }else{

        var wallet = new Crypto.Wallet;
        var address = await wallet.request('getnewaddress')
        var privkey = await wallet.request('dumpprivkey', [address['result']])
        var validate = await wallet.request('validateaddress', [address['result']])

        res.json({
            address: address['result'],
            private_key: privkey['result'],
            pub_key: validate['result']['pubkey'],
            status: 200
        })

    }
};

export async function init(req: express.Request, res: express.Response) {
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['address'] !== undefined){
        var txid
        mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
            const db = client.db(global['db_name'])
            let check = await db.collection('initialized').find({address: request['body']['address']}).toArray()

            if(check[0] === undefined){
                var wallet = new Crypto.Wallet;
                var balance = await wallet.request('getbalance')
                var airdrop_value = parseFloat(process.env.AIRDROP)
                if(balance['result'] > airdrop_value){
                    var airdrop_tx = await wallet.request('sendtoaddress',[request['body']['address'],airdrop_value])
                    txid = airdrop_tx['result']
                    if(txid !== null){
                        await db.collection('initialized').insertOne({address: request['body']['address'], txid: txid})
                    }
                }else{
                    console.log('Balance insufficient for airdrop')
                    txid = false
                }

            }else{
                txid = false
            }

            client.close()

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

export async function send(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['from'] !== undefined && request['body']['to'] !== undefined && request['body']['amount'] !== undefined && request['body']['private_key'] !== undefined){
        var from = request['body']['from']
        var to = request['body']['to']
        var amount = parseFloat(request['body']['amount'])
        var private_key = request['body']['private_key']

        var metadata
        if(request['body']['message'] !== undefined){
            metadata = request['body']['message']
        }

        wallet.request('validateaddress',[from]).then(async response => {
            var validation = response['result']
            if(validation.isvalid === true){
                wallet.request('validateaddress',[to]).then(async response => {
                    var validation = response['result']
                    if(validation.isvalid === true){
                        if(amount > 0){
                            var txid = <string> await wallet.send(private_key,from,to,amount,metadata)
                            if(txid !== 'false'){
                                res.json({
                                    data: {
                                        success: true,
                                        txid: txid
                                    },
                                    status: 200
                                })
                            }else{
                                res.json({
                                    data: {
                                        success: false
                                    },
                                    status: 501
                                })
                            }
                        }else{
                            res.json({
                                data: 'Amount must be grater than zero.',
                                status: 402
                            })
                        }
                    }else{
                        res.json({
                            data: 'Receiving address is invalid.',
                            status: 402
                        })
                    }
                })
            }else{
                res.json({
                    data: 'Sending address is invalid.',
                    status: 402
                })
            }
        })
    }else{
        res.json({
            data: 'Provide from, to, amount and private key first.',
            status: 402
        })
    }
};

export async function sendrawtransaction(req: express.Request, res: express.Response) {
    var wallet = new Crypto.Wallet;
    var parser = new Utilities.Parser
    var request = await parser.body(req)
    if(request['body']['rawtransaction'] !== undefined){
        wallet.request('sendrawtransaction',[request['body']['rawtransaction']]).then(async response => {
            /*if(response['result'] !== null){
                let decoderawtransaction = await wallet.request('decoderawtransaction', [request['body']['rawtransaction']])
                let decoded = decoderawtransaction['result']
                for(let x in decoded.vin){
                    global['txidcache'].push(decoded.vin[x].txid)
                    delete global['utxocache'][decoded.vin[x].txid]
                }
                let voutchange = 1
                if(decoded.vout[0].scriptPubKey.addresses !== undefined){
                    let unspent = {
                        txid: decoded.txid,
                        vout: voutchange,
                        address: decoded.vout[voutchange].scriptPubKey.addresses[0],
                        scriptPubKey: decoded.vout[voutchange].scriptPubKey.hex,
                        amount: decoded.vout[voutchange].value
                    }
                    global['utxocache'][decoded.txid] = unspent
                    console.log("UNSPENT IS",unspent)
                }
            }*/
            res.json({
                data: response['result'],
                status: 200
            })
        })
    }else{
        res.json({
            data: 'Provide raw transaction first.',
            status: 402
        })
    }
};
