"use strict";
import express = require("express")
import * as Crypto from './Crypto'
import * as Sidechain from './Planum'
import * as Utilities from './Utilities'
import * as Contracts from './Contracts'
require('dotenv').config()
const mongo = require('mongodb').MongoClient
import { create, all, exp } from 'mathjs'
import { Console } from "console";
import SideChain = require("./Planum");
const messages = require('./p2p/messages.js')
const console = require('better-console')
const LZUTF8 = require('lzutf8')
const axios = require('axios')
const fs = require('fs')
const vm = require('@scrypta/vm')
const ScryptaCore = require('@scrypta/core')
const scrypta = new ScryptaCore

const config = {
    epsilon: 1e-12,
    matrix: 'Matrix',
    number: 'number',
    precision: 64,
    predictable: false,
    randomSeed: null
}
const math = create(all, config)
var blocks = 0
var analyze = 0

module Daemon {

    export class Sync {

        public async init() {
            if (global['isSyncing'] === false) {
                var wallet = new Crypto.Wallet
                // console.clear()
                global['retrySync'] = 0
                wallet.request('getinfo').then(info => {
                    blocks = info['result'].blocks
                    let utils = new Utilities.Parser
                    utils.log('FOUND ' + blocks + ' BLOCKS IN THE BLOCKCHAIN')
                    var task = new Daemon.Sync
                    task.process()
                })
            } else {
                console.log('\x1b[41m%s\x1b[0m', 'CAN\'T INIT, IDANODE IS SYNCING YET!')
            }
        }

        public async process() {
            if (global['isSyncing'] === false) {
                let utils = new Utilities.Parser

                // CHECK IF THERE ARE PINNED CONTRACTS
                let contracts = new Contracts.Local
                let pinned = await contracts.pinned()

                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        global['retrySync'] = 0
                        global['isSyncing'] = true
                        var task = new Daemon.Sync
                        const sync = await db.collection('blocks').find().sort({ block: -1 }).limit(2).toArray()
                        var last
                        if (sync[0] === undefined) {
                            utils.log('Sync lock not found, creating')
                            await db.collection('blocks').insertOne({ block: 0, time: new Date().getTime() }, { w: 1, j: true });
                            last = 0
                        } else {
                            last = sync[0].block
                            let continuitycheck = last - 1
                            if (continuitycheck !== sync[1].block) {
                                last = continuitycheck - 1
                            }
                            if (sync[0].block === sync[1].block) {
                                await db.collection('blocks').deleteOne({ _id: sync[0]._id })
                            }
                        }

                        if (last !== null && last !== undefined) {
                            analyze = parseInt(last) + 1
                        } else {
                            analyze = 1
                        }

                        // ANALYZING MEMPOOL ONLY IF SYNC IS FINISHED
                        var remains = blocks - analyze
                        if (remains === -1) {
                            console.log('\x1b[31m%s\x1b[0m', 'ANALYZING MEMPOOL')
                            var wallet = new Crypto.Wallet
                            var mempool = await wallet.analyzeMempool()
                            if (mempool !== false) {
                                global['retrySync'] = 0
                                for (var address in mempool['data_written']) {
                                    var data = mempool['data_written'][address]
                                    console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                                    for (var dix in data) {
                                        if (data[dix].protocol !== 'chain://') {
                                            await task.storewritten(data[dix], true)
                                        } else {
                                            await task.storewritten(data[dix], true)
                                            await task.storeplanum(data[dix], true)
                                        }
                                    }
                                }

                                for (var address in mempool['data_received']) {
                                    var data = mempool['data_received'][address]
                                    console.log('\x1b[32m%s\x1b[0m', 'FOUND RECEIVED DATA FOR ' + address + '.')
                                    for (var dix in data) {
                                        await task.storereceived(data[dix])
                                    }
                                }

                                for (var txid in mempool['analysis']) {
                                    for (var address in mempool['analysis'][txid]['balances']) {
                                        var tx = mempool['analysis'][txid]['balances'][address]
                                        var movements = mempool['analysis'][txid]['movements']
                                        console.log('STORING ' + tx.type + ' OF ' + tx.value + ' ' + process.env.COIN + ' FOR ADDRESS ' + address + ' FROM MEMPOOL')
                                        await task.store(address, mempool, txid, tx, movements)
                                    }
                                }

                                for (var i in mempool['outputs']) {
                                    let unspent = mempool['outputs'][i]
                                    var found = false
                                    for (var i in mempool['inputs']) {
                                        let input = mempool['inputs'][i]
                                        if (input['txid'] === unspent['txid'] && input['vout'] === unspent['vout']) {
                                            found = true
                                        }
                                    }
                                    if (found === false) {
                                        await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], null)
                                    } else {
                                        console.log('\x1b[35m%s\x1b[0m', 'IGNORING OUTPUTS BECAUSE IT\'S USED IN THE SAME BLOCK.')
                                    }
                                }

                                for (var i in mempool['inputs']) {
                                    let input = mempool['inputs'][i]
                                    await task.redeemunspent(input['txid'], input['vout'], null)
                                }

                                if (mempool['outputs'].length > 0 && pinned.length > 0) {
                                    for (let k in pinned) {
                                        let contract = pinned[k]
                                        let request = {
                                            function: "ifMempool",
                                            params: mempool,
                                            contract: contract.contract,
                                            version: contract.version
                                        }
                                        let contractDetails = await vm.read(contract.contract, true, contract.version)
                                        if (contractDetails.functions.indexOf('ifMempool') !== -1) {
                                            console.log('RUNNING IFMEMPOOL TRANSACTION IN CONTRACT ' + contract.contract)
                                            try {
                                                let hex = Buffer.from(JSON.stringify(request)).toString('hex')
                                                let signed = await wallet.signmessage(process.env.NODE_KEY, hex)
                                                let contractResponse = await vm.run(contract.contract, signed, true)
                                                if (contractResponse !== undefined && contractResponse !== false) {
                                                    utils.log(contractResponse)
                                                }
                                            } catch (e) {
                                                console.log(e)
                                                utils.log('ERROR ON IFMEMPOOL CONTRACT', '', 'errors')
                                                utils.log(e, '', 'errors')
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        client.close()

                        if (analyze <= blocks) {
                            global['remainingBlocks'] = remains
                            let errors = false
                            if (remains === 0) {
                                // CONSOLIDATING TRANSACTIONS WITHOUT CONFIRMS FIRST
                                try {
                                    await task.consolidatestored()
                                } catch (e) {
                                    utils.log('ERROR WHILE CONSOLIDATING', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    await scrypta.sleep('2000')
                                    global['isSyncing'] = false
                                    errors = true
                                }
                            }
                            if (global['syncLock'] === false && errors === false) {
                                let utils = new Utilities.Parser
                                try {
                                    let synced: any = false
                                    while (synced === false) {
                                        try {
                                            synced = await task.analyze()
                                        } catch (e) {
                                            utils.log('ERROR WHILE ANALYZING BLOCK', '', 'errors')
                                            utils.log(e)
                                        }
                                        if (synced !== false && parseInt(synced) > 0) {
                                            global['retrySync'] = 0
                                            utils.log('SUCCESSFULLY SYNCED BLOCK ' + synced, '\x1b[46m%s\x1b[0m')
                                            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                                                var db = client.db(global['db_name'])
                                                let saved = false
                                                while (saved === false) {
                                                    try {
                                                        await db.collection('blocks').insertOne({ block: synced, time: new Date().getTime() }, { w: 1, j: true })
                                                        let savecheck = await db.collection('blocks').find({ block: synced }).toArray()
                                                        if (savecheck[0] !== undefined && savecheck[0].block === synced) {
                                                            saved = true
                                                        }
                                                    } catch (e) {
                                                        utils.log('ERROR WHILE SAVING BLOCK CHECK', '', 'errors')
                                                    }
                                                }
                                                global['isSyncing'] = false
                                                client.close()
                                                setTimeout(function () {
                                                    task.process()
                                                }, 10)
                                            })
                                        } else if (synced === 'RESTART') {
                                            global['isSyncing'] = false
                                            synced = true
                                            utils.log('SIDECHAIN NOT WORKING, RESTARTING PROCESS.', '\x1b[41m%s\x1b[0m', 'errors')
                                            await scrypta.sleep('2000')
                                            setTimeout(function () {
                                                task.process()
                                            }, 10)
                                        } else {
                                            utils.log('BLOCK NOT SYNCED, RETRY.', '\x1b[41m%s\x1b[0m', 'errors')
                                            await scrypta.sleep('2000')
                                            global['isSyncing'] = false
                                        }
                                    }
                                } catch (e) {
                                    utils.log('ERROR WHILE SYNCING BLOCK')
                                    utils.log(e, '', 'errors')
                                    global['isSyncing'] = false
                                    setTimeout(function () {
                                        task.process()
                                    }, 1000)
                                }
                            }
                        } else {
                            global['isSyncing'] = false
                            console.log('SYNC FINISHED')
                        }
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    global['isSyncing'] = false
                    setTimeout(function () {
                        var task = new Daemon.Sync
                        task.process()
                    }, 1000)
                }
            } else {
                console.log('\x1b[41m%s\x1b[0m', 'CAN\'T PROCESS, IDANODE IS SYNCING YET!')
            }
        }

        public async analyze(toAnalyze = null) {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                global['retrySync'] = 0
                try {
                    if (toAnalyze !== null) {
                        analyze = toAnalyze
                    }
                    // ANALYZING BLOCK
                    if (analyze > 0 && global['isAnalyzing'] === false) {
                        global['isAnalyzing'] = true
                        console.log('\x1b[32m%s\x1b[0m', 'ANALYZING BLOCK ' + analyze)

                        var wallet = new Crypto.Wallet
                        let blockhash = null
                        let hashfound = false
                        while (hashfound === false) {
                            blockhash = await wallet.request('getblockhash', [analyze])
                            if (blockhash !== undefined && blockhash !== null && blockhash['result'] !== undefined && blockhash['result'] !== null) {
                                hashfound = true
                            }
                        }
                        if (blockhash !== undefined && blockhash !== null && blockhash['result'] !== undefined && blockhash['result'] !== null) {
                            let block = false
                            let analyzed = false
                            while (block === false) {
                                let analyzation = await wallet.analyzeBlock(blockhash['result'])
                                if (analyzation !== false) {
                                    block = analyzation
                                    analyzed = true
                                }
                            }

                            if (analyzed !== false) {
                                for (var txid in block['analysis']) {
                                    for (var address in block['analysis'][txid]['balances']) {
                                        var tx = block['analysis'][txid]['balances'][address]
                                        var movements = block['analysis'][txid]['movements']
                                        var task = new Daemon.Sync
                                        console.log('STORING ' + tx.type + ' OF ' + tx.value + ' ' + process.env.COIN + ' FOR ADDRESS ' + address)
                                        let storedtx = await task.store(address, block, txid, tx, movements)
                                        if (storedtx === false) {
                                            utils.log('ERROR ON STORE TRANSACTION')
                                            response(false)
                                        }
                                    }
                                }

                                for (var i in block['outputs']) {
                                    let unspent = block['outputs'][i]
                                    var found = false
                                    for (var i in block['inputs']) {
                                        let input = block['inputs'][i]
                                        if (input['txid'] === unspent['txid'] && input['vout'] === unspent['vout']) {
                                            found = true
                                        }
                                    }
                                    if (found === false) {
                                        let storedunspent = await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], analyze)
                                        if (storedunspent === false) {
                                            utils.log('ERROR ON STORE UNSPENT')
                                            response(false)
                                        }
                                    } else {
                                        console.log('\x1b[35m%s\x1b[0m', 'IGNORING OUTPUTS BECAUSE IT\'S USED IN THE SAME BLOCK.')
                                    }
                                }

                                for (var i in block['inputs']) {
                                    let input = block['inputs'][i]
                                    let redeemedunspent = await task.redeemunspent(input['txid'], input['vout'], analyze)
                                    if (redeemedunspent === false) {
                                        utils.log('ERROR ON REDEEM UNSPENT')
                                        response(false)
                                    }
                                }

                                // console.log('CLEANING UTXO CACHE')
                                global['utxocache'] = []
                                global['txidcache'] = []
                                // console.log('CLEANING USXO CACHE')
                                global['usxocache'] = []
                                global['sxidcache'] = []

                                // CLEAN PLANUN MEMPOOL
                                if (block['planum'].length > 0) {
                                    let cleaned = false
                                    while (cleaned === false) {
                                        try {
                                            cleaned = await task.cleanplanum(block['planum'], block['height'])
                                        } catch (e) {
                                            utils.log('ERROR CLEANING PLANUM', '', 'errors')
                                        }
                                    }

                                    let sidechains = []
                                    //STORE PLANUM DATA
                                    for (var dix in block['planum']) {
                                        utils.log('FOUND PLANUM TX.', '\x1b[32m%s\x1b[0m')
                                        var task = new Daemon.Sync
                                        let storedwritten = false
                                        while (storedwritten === false) {
                                            try {
                                                storedwritten = await task.storewritten(block['planum'][dix], false, block['height'])
                                                if (storedwritten === false) {
                                                    utils.log('ERROR STORING WRITTEN DATA ON PLANUM', '', 'errors')
                                                }
                                            } catch (e) {
                                                storedwritten = false
                                                utils.log('ERROR STORING WRITTEN DATA ON PLANUM', '', 'errors')
                                            }
                                        }
                                        let storedplanum = false
                                        if (sidechains.indexOf(block['planum'][dix]['data']['transaction']['sidechain']) === -1) {
                                            sidechains.push(block['planum'][dix]['data']['transaction']['sidechain'])
                                        }
                                        while (storedplanum === false) {
                                            try {
                                                storedplanum = await task.storeplanum(block['planum'][dix], false, block['height'])
                                                if (storedplanum === false) {
                                                    utils.log('ERROR STORING PLANUM', '', 'errors')
                                                }
                                            } catch (e) {
                                                storedplanum = false
                                                utils.log('ERROR STORING PLANUM DATA ON PLANUM', '', 'errors')
                                            }
                                        }
                                    }

                                    utils.log('CHECK ' + sidechains.length + ' CHANGED SIDECHAINS')
                                    for (let sxi in sidechains) {
                                        let sidechain = sidechains[sxi]
                                        utils.log('START CHECKING ' + sidechain)
                                        let checked = false
                                        let validated = false
                                        while (checked === false) {
                                            try {
                                                let resultvalidation = await task.checkplanum(sidechain)
                                                utils.log('VALIDATION RESULT IS ' + JSON.stringify(resultvalidation))
                                                if (resultvalidation.validated === false && resultvalidation.checked === true) {
                                                    checked = true
                                                } else if (resultvalidation.validated === true && resultvalidation.checked === true) {
                                                    validated = true
                                                    checked = true
                                                }
                                            } catch (e) {
                                                utils.log('ERROR WHILE VALIDATING SIDECHAIN', '', 'errors')
                                                utils.log(e)
                                            }
                                        }
                                        if (validated === false) {
                                            let cleaned = false
                                            while (cleaned === false) {
                                                try {
                                                    cleaned = await task.cleanplanum(block['planum'], block['height'])
                                                } catch (e) {
                                                    utils.log('ERROR CLEANING PLANUM', '', 'errors')
                                                }
                                            }
                                            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                                                var db = client.db(global['db_name'])
                                                global['restartSync'] = global['restartSync'] + 1
                                                let lasts = await db.collection('blocks').find().sort({ block: -1 }).limit(global['restartSync']).toArray()
                                                for (let k in lasts) {
                                                    let last = lasts[k]
                                                    await db.collection('blocks').deleteOne({ block: last[0].block })
                                                }
                                                utils.log('ERROR WHILE STORING SIDECHAINS TRANSACTIONS, NOW IS INVALID, RETRY SYNC BLOCK.', '', 'errors')
                                                response('RESTART')
                                            })
                                        } else {
                                            global['restartSync'] = 0
                                            utils.log('SIDECHAIN ' + sidechain + ' SUCCESSFULLY VALIDATED AFTER CHANGE', '\x1b[32m%s\x1b[0m')
                                        }
                                    }
                                }

                                // STORE GENERAL DATA
                                for (var address in block['data_written']) {
                                    var data = block['data_written'][address]
                                    console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                                    for (var dix in data) {
                                        if (data[dix].protocol !== 'chain://') {
                                            var task = new Daemon.Sync
                                            let storedwritten = false
                                            while (storedwritten === false) {
                                                storedwritten = await task.storewritten(data[dix], false, block['height'])
                                                if (storedwritten === false) {
                                                    utils.log('ERROR ON STORE WRITTEN DATA', '', 'errors')
                                                }
                                            }
                                        }
                                    }
                                }

                                // STORE RECEIVED DATA
                                for (var address in block['data_received']) {
                                    var data = block['data_received'][address]
                                    console.log('\x1b[32m%s\x1b[0m', 'FOUND RECEIVED DATA FOR ' + address + '.')
                                    for (var dix in data) {
                                        var task = new Daemon.Sync
                                        let storedreceived = false
                                        while (storedreceived === false) {
                                            storedreceived = await task.storereceived(data[dix])
                                            if (storedreceived === false) {
                                                utils.log('ERROR ON STORE RECEIVED', '', 'errors')
                                            }
                                        }
                                    }
                                }

                                // CHECK IF THERE ARE PINNED CONTRACTS
                                try {
                                    let contracts = new Contracts.Local
                                    let pinned = await contracts.pinned()

                                    // RUN CONTRACTS CALLS
                                    if (pinned.length > 0) {
                                        for (let k in pinned) {
                                            let contract = pinned[k]
                                            let request = {
                                                function: "eachBlock",
                                                params: block,
                                                contract: contract.contract,
                                                version: contract.version
                                            }
                                            let contractDetails = await vm.read(contract.contract, true, contract.version)
                                            if (contractDetails.functions.indexOf('eachBlock') !== -1) {
                                                utils.log('RUNNING EACHBLOCK TRANSACTION IN CONTRACT ' + contract.contract)
                                                try {
                                                    let hex = Buffer.from(JSON.stringify(request)).toString('hex')
                                                    let signed = await wallet.signmessage(process.env.NODE_KEY, hex)
                                                    let contractResponse = await vm.run(contract.contract, signed, true)
                                                    if (contractResponse !== undefined && contractResponse !== false) {
                                                        utils.log(contractResponse)
                                                    }
                                                } catch (e) {
                                                    utils.log(e, '', 'errors')
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    utils.log('ERROR WHILE RUNNING CONTRACTS', '', 'errors')
                                    utils.log(e)
                                }

                                var remains = blocks - analyze
                                console.log('\x1b[33m%s\x1b[0m', remains + ' BLOCKS UNTIL END.')
                                global['isAnalyzing'] = false
                                response(block['height'])
                            } else {
                                global['isAnalyzing'] = false
                                utils.log('ERROR, ANALYZING BLOCK FAILED', '', 'errors')
                                setTimeout(function () {
                                    task.process()
                                }, 500)
                                response(false)
                            }
                        } else {
                            global['isAnalyzing'] = false
                            utils.log('ERROR, CAN\'T GET BLOCK DETAILS', '', 'errors')
                            setTimeout(function () {
                                task.process()
                            }, 500)
                            response(false)
                        }
                    } else {
                        global['isAnalyzing'] = false
                        utils.log('ERROR, ANALYZING IN PROCESS', '', 'errors')
                        response(false)
                    }
                } catch (e) {
                    utils.log('ERROR INSIDE ANALYZE FUNCTION', '', 'errors')
                    utils.log(e, '', 'errors')
                    global['isAnalyzing'] = false
                    response(false)
                }
            })

        }

        private async store(address, block, txid, tx, movements) {
            return new Promise(async response => {
                let utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        let check = await db.collection('transactions').find({ address: address, txid: txid }).limit(1).toArray();
                        if (check[0] === undefined) {
                            // console.log('STORING TX NOW!')
                            await db.collection("transactions").insertOne(
                                {
                                    address: address,
                                    txid: txid,
                                    type: tx.type,
                                    from: movements.from,
                                    to: movements.to,
                                    value: tx.value,
                                    blockhash: block['hash'],
                                    blockheight: block['height'],
                                    time: block['time'],
                                    inserted: new Date().getTime()
                                }, { w: 1, j: true }
                            )
                        } else if (check[0].blockheight === null && block['height'] !== undefined) {
                            await db.collection("transactions").updateOne({
                                address: address, txid: txid
                            }, {
                                $set: {
                                    blockheight: block['height'],
                                    blockhash: block['hash'],
                                    time: block['time']
                                }
                            }, { upsert: true, writeConcern: { w: 1, j: true } })
                        } else {
                            console.log('TX ALREADY STORED.')
                        }
                        client.close()
                        response(block['height'])
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private async storeunspent(address, vout, txid, amount, scriptPubKey, block) {
            return new Promise(async response => {
                let utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        let check = await db.collection("unspent").find({ txid: txid, vout: vout }).limit(1).toArray()
                        if (check[0] === undefined) {
                            console.log('\x1b[36m%s\x1b[0m', 'STORING UNSPENT NOW!')
                            await db.collection("unspent").insertOne(
                                {
                                    address: address,
                                    txid: txid,
                                    scriptPubKey: scriptPubKey,
                                    amount: amount,
                                    vout: vout,
                                    block: block,
                                    redeemed: null,
                                    redeemblock: null
                                }, { w: 1, j: true }
                            )
                        } else if (check[0].block === null && block !== null) {
                            console.log('\x1b[36m%s\x1b[0m', 'UPDATING BLOCK NOW!')
                            await db.collection("unspent").updateOne({ txid: txid, vout: vout }, { $set: { block: block } }, { upsert: true, writeConcern: { w: 1, j: true } })
                        } else {
                            console.log('UNSPENT ALREADY STORED.')
                        }
                        client.close()
                        response(true)
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private async redeemunspent(txid, vout, block) {
            return new Promise(async response => {
                let utils = new Utilities.Parser
                try {
                    console.log('\x1b[31m%s\x1b[0m', 'REDEEMING UNSPENT NOW!')
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        await db.collection('unspent').updateOne({ txid: txid, vout: vout }, { $set: { redeemblock: block, redeemed: txid } }, { w: 1, j: true })
                        client.close()
                        response(true)
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private pinipfsfolder(hash) {
            return new Promise(async response => {
                for (let x in hash.children) {
                    let entry = hash.children[x]
                    if (entry.children !== undefined) {
                        console.log('Pinning subfolder ' + entry.name)
                        let hashedfolder = await this.pinipfsfolder(entry)
                        hash.children[x] = hashedfolder
                    } else {
                        if (entry.ipfs !== undefined) {
                            console.log('\x1b[42m%s\x1b[0m', 'PINNING IPFS HASH ' + entry.ipfs)
                            global['ipfs'].pin.add(entry.ipfs, function (err) {
                                if (err) {
                                    throw err
                                }
                            })
                        }
                    }
                }
                response(true)
            })
        }

        private async storewritten(datastore, isMempool = false, block = null): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    datastore.block = block
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        let check = await db.collection('written').find({ uuid: datastore.uuid, block: datastore.block }).limit(1).toArray()
                        if (check[0] === undefined) {
                            console.log('STORING DATA NOW!')
                            utils.log('WRITTEN DATA ' + JSON.stringify(datastore))
                            if (JSON.stringify(datastore.data).indexOf('ipfs:') !== -1) {
                                let parsed = datastore.data.split('***')
                                if (parsed[0] !== undefined && process.env.PINIPFS === 'true') {
                                    let parsehash = parsed[0].split(':')
                                    if (parsehash[1] !== undefined && parsehash[1] !== 'undefined') {
                                        console.log('\x1b[42m%s\x1b[0m', 'PINNING IPFS HASH ' + parsehash[1])
                                        global['ipfs'].pin.add(parsehash[1], function (err) {
                                            if (err) {
                                                throw err
                                                client.close()
                                                response(false)
                                            }
                                        })
                                    }
                                }
                            }

                            if (datastore.protocol === 'bvc://' && global['pinipfs'] === true) {
                                var task = new Daemon.Sync
                                await task.pinipfsfolder(datastore.data)
                            }

                            if (datastore.protocol === 'documenta://') {
                                var wallet = new Crypto.Wallet;
                                let valid = true
                                let pubkey

                                if (datastore.data.pubkey !== undefined) {
                                    pubkey = datastore.data.pubkey
                                } else if (datastore.data.pubKey !== undefined) {
                                    pubkey = datastore.data.pubKey
                                }

                                if (pubkey !== undefined && pubkey.length > 0 && datastore.data.signature !== undefined && datastore.data.message !== undefined) {
                                    let validatesign = await wallet.verifymessage(pubkey, datastore.data.signature, datastore.data.message)
                                    if (validatesign === false) {
                                        valid = false
                                    }
                                } else {
                                    valid = false
                                }

                                if (valid) {
                                    var file = JSON.parse(datastore.data.message)
                                    let checkfile = await db.collection("documenta").findOne({ file: file.file })
                                    if (checkfile === null) {
                                        file.endpoint = file.endpoint
                                        file.address = datastore.data.address
                                        file.refID = datastore.refID
                                        file.block = datastore.block
                                        file.time = new Date().getTime()
                                        try {
                                            await db.collection("documenta").insertOne(file, { w: 1, j: true })
                                        } catch (e) {
                                            utils.log('DB ERROR', '', 'errors')
                                            utils.log(e, '', 'errors')
                                            client.close()
                                            response(false)
                                        }
                                    } else {
                                        await db.collection("documenta").updateOne({ file: file.file }, { $set: { block: datastore.block } }, { upsert: true, writeConcern: { w: 1, j: true } })
                                        console.log('FILE STORED YET')
                                    }
                                }

                            }

                            if (datastore.uuid !== undefined && datastore.uuid !== '') {
                                try {
                                    await db.collection("written").insertOne(datastore, { w: 1, j: true })
                                } catch (e) {
                                    utils.log('DB ERROR', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                    response(false)
                                }
                            }
                        } else {
                            if (datastore.block !== null) {
                                utils.log('DATA ALREADY STORED AT BLOCK ' + datastore.block + '.')
                            } else {
                                utils.log('DATA ALREADY STORED FROM MEMPOOL.')
                            }
                        }

                        client.close()
                        response('STORED')
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private async cleanplanum(transactions, blockheight): Promise<boolean> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (!err) {
                            var db = client.db(global['db_name'])
                            try {
                                let sidechains = []
                                for (let y in transactions) {
                                    let datastore = transactions[y]
                                    for (let x in datastore.data.transaction.inputs) {
                                        let sxid = datastore.data.transaction.inputs[x].sxid
                                        let vout = datastore.data.transaction.inputs[x].vout
                                        if (sidechains.indexOf(datastore.data.transaction.sidechain) === -1) {
                                            sidechains.push(datastore.data.transaction.sidechain)
                                        }
                                        try {
                                            await db.collection('sc_unspent').updateOne({ sxid: sxid, vout: vout }, { $set: { redeemed: null, redeemblock: null } }, { upsert: true, writeConcern: { w: 1, j: true } })
                                        } catch (e) {
                                            utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                            client.close()
                                            response(false)
                                        }
                                    }
                                }
                                utils.log('CLEANING SIDECHAINS ' + JSON.stringify(sidechains))
                                for (let k in sidechains) {
                                    let sidechain = sidechains[k]
                                    utils.log('CLEANING ' + sidechain, '', 'log')
                                    try {
                                        await db.collection('sc_transactions').deleteMany({ "transaction": { $exists: true }, "transaction.sidechain": sidechain, block: null }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('sc_unspent').deleteMany({ sidechain: sidechain, block: null }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('sc_transactions').deleteMany({ "transaction": { $exists: true }, "transaction.sidechain": sidechain, block: blockheight }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('sc_unspent').deleteMany({ sidechain: sidechain, block: blockheight }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                        client.close()
                                        response(false)
                                    }
                                }
                                utils.log('CLEAN SUCCESS ON BLOCK', '', 'log')
                                client.close()
                                response(true)
                            } catch (e) {
                                utils.log('CLEAN ERROR ON BLOCK', '', 'errors')
                                client.close()
                                response(false)
                            }
                        } else {
                            client.close()
                            response(false)
                        }
                    })
                } catch (e) {
                    response(false)
                }
            })
        }

        private async checkplanum(sidechain): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (!err) {
                            var db = client.db(global['db_name'])
                            let sxids = []
                            let cap = 0
                            let issued = 0
                            let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                            if (check_sidechain[0] !== undefined) {
                                let issue = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                                let unspents = await db.collection('sc_unspent').find({ sidechain: sidechain, redeemed: null }).sort({ block: 1 }).toArray()
                                issued += issue[0].data.genesis.supply
                                let reissues = await db.collection('written').find({ address: check_sidechain[0].data.genesis.owner, "data.reissue": { $exists: true }, "data.reissue.sidechain": sidechain }).sort({ block: 1 }).toArray()
                                let decimals = check_sidechain[0].data.genesis.decimals

                                // CALCULATING REISSUES
                                let reissuestxs = []
                                for (let k in reissues) {
                                    let check = await db.collection('sc_transactions').find({ sxid: reissues[k].data.sxid }).limit(1).toArray()
                                    if (check[0] !== undefined) {
                                        if (reissuestxs.indexOf(reissues[k].data.signature) === -1) {
                                            reissuestxs.push(reissues[k].data.signature)
                                            issued = math.sum(issued, reissues[k].data.reissue.supply)
                                        }
                                    }
                                }

                                // CALCULATING CURRENT CAP
                                let users = []
                                for (let x in unspents) {
                                    let unspent = unspents[x]
                                    if (unspent.sxid !== undefined && unspent.sxid !== null && sxids.indexOf(unspent.sxid + ':' + unspent.vout) === -1) {
                                        sxids.push(unspent.sxid + ':' + unspent.vout)
                                        let amount = math.round(unspent.amount, decimals)
                                        cap = math.sum(cap, amount)
                                        if (users.indexOf(unspent.address) === -1) {
                                            users.push(unspent.address)
                                        }
                                    }
                                }
                                cap = math.round(cap, decimals)
                                issued = math.round(issued, decimals)
                                utils.log('SIDECHAIN ' + sidechain + ' ISSUED ' + issued + ' NOW CAP IS ' + cap)
                                if (cap !== issued) {
                                    response({ checked: true, validated: false })
                                } else {
                                    response({ checked: true, validated: true })
                                }
                            } else {
                                response({ checked: true, validated: false })
                            }
                        } else {
                            response({ checked: false, validated: false })
                        }
                    })
                } catch (e) {
                    utils.log('CAN\'T VALIDATE PLANUM, RETRY.')
                    response({ checked: false, validated: false })
                }
            })
        }

        private async storeplanum(datastore, isMempool = false, block = null): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (err) {
                            client.close()
                            response(false)
                        }
                        var db = client.db(global['db_name'])
                        datastore.block = block
                        if (datastore.protocol === 'chain://') {
                            // SEARCHING FOR GENESIS
                            if (datastore.data !== undefined) {
                                datastore.data['txid'] = datastore['txid']
                            }
                            if (datastore.data.genesis !== undefined) {
                                let check = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                if (check[0] === undefined) {
                                    utils.log('STORING GENESIS SXID NOW!')
                                    await db.collection("sc_transactions").insertOne(datastore.data, { w: 1, j: true })
                                } else {
                                    utils.log('GENESIS SXID ALREADY STORED.')
                                    if (datastore.block !== null) {
                                        await db.collection("sc_transactions").updateOne({ sxid: datastore.data.sxid }, { $set: { block: datastore.block } }, { upsert: true, writeConcern: { w: 1, j: true } })
                                    }
                                }
                            }

                            // SEARCHING FOR REISSUE
                            if (datastore.data.reissue !== undefined) {
                                let check = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                if (check[0] === undefined) {
                                    utils.log('STORING REISSUE SXID NOW!')
                                    await db.collection("sc_transactions").insertOne(datastore.data, { w: 1, j: true })
                                } else {
                                    utils.log('REISSUE SXID ALREADY STORED.')
                                    if (datastore.block !== null) {
                                        await db.collection("sc_transactions").updateOne({ sxid: datastore.data.sxid }, { $set: { block: datastore.block } }, { upsert: true, writeConcern: { w: 1, j: true } })
                                    }
                                }
                            }

                            //SEARCHING FOR TRANSACTION
                            if (datastore.data.transaction !== undefined) {
                                var scwallet = new Sidechain.Wallet;
                                console.log('PLANUM TRANSACTION FOUND.')
                                try {
                                    var check = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                    var check_sidechain = await db.collection('written').find({ address: datastore.data.transaction.sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                                } catch (e) {
                                    client.close()
                                    response(false)
                                }
                                if (check_sidechain[0] !== undefined) {
                                    if (check[0] === undefined) {
                                        // TRANSACTION NEVER STORED
                                        utils.log('TRANSACTION NEVER STORED')
                                        let valid = true
                                        var amountinput = 0
                                        var amountoutput = 0
                                        var isGenesis = false
                                        var isExtended = false

                                        // CHECKING IF TRANSACTION IS CONTROLLED BY A SMART CONTRACT
                                        if (datastore.data.contract !== undefined && datastore.data.contract.address !== undefined) {
                                            isExtended = true
                                            if (check_sidechain[0].data.genesis.extendable === true && check_sidechain[0].data.genesis.contract !== '' && check_sidechain[0].data.genesis.contract === datastore.data.contract.address) {
                                                if (datastore.data.transaction.inputs.length > 0) {
                                                    let toValidateByContract = datastore.data.transaction.inputs[0]
                                                    if (toValidateByContract.function !== undefined && toValidateByContract.params !== undefined) {
                                                        let searchRequest = {
                                                            function: "index",
                                                            params: { contract: datastore.data.contract.address },
                                                            contract: 'LgSAtP3gPURByanZSM32kfEu9C1uyQ6Kfg',
                                                            version: 'latest'
                                                        }
                                                        utils.log('SEARCH WHERE CONTRACT IS STORED')
                                                        try {
                                                            let searchhex = Buffer.from(JSON.stringify(searchRequest)).toString('hex')
                                                            let searchsigned = await wallet.signmessage(process.env.NODE_KEY, searchhex)
                                                            let maintainers = await vm.run(datastore.data.contract.address, searchsigned, true)
                                                            if (maintainers !== undefined && maintainers !== false) {
                                                                if (maintainers.length > 0) {
                                                                    // RUN CONTRACT AND LET'S SEE IF IS TRANSACTION VALID
                                                                    let validationRequest = {
                                                                        function: toValidateByContract.function,
                                                                        params: toValidateByContract.params,
                                                                        contract: datastore.data.contract.address,
                                                                        version: datastore.data.contract.version
                                                                    }
                                                                    let validationhex = Buffer.from(JSON.stringify(validationRequest)).toString('hex')
                                                                    let answered = false
                                                                    let aix = 0
                                                                    while (answered === false) {
                                                                        let idanode = maintainers[Math.floor(Math.random() * maintainers.length)]
                                                                        utils.log('ASKING ' + idanode.url + ' TO VALIDATE TRANSACTION')
                                                                        let validationsigned = await wallet.signmessage(process.env.NODE_KEY, validationhex)
                                                                        let validationresponse = await axios.post(idanode.url + '/contracts/run', validationsigned)
                                                                        if (validationresponse.data !== undefined) {
                                                                            answered = true
                                                                            if (validationresponse.data === false) {
                                                                                valid = false
                                                                            } else {
                                                                                if (validationresponse !== datastore.data.transaction.outputs) {
                                                                                    valid = false
                                                                                }
                                                                            }
                                                                        }
                                                                        aix++
                                                                        if (aix > 9) {
                                                                            answered = true
                                                                            valid = false
                                                                            utils.log('CAN\'T GET RESPONSE FROM MAINTAINERS')
                                                                        }
                                                                    }
                                                                } else {
                                                                    valid = false
                                                                    utils.log('NO ONE MAINTAIN CONTRACT ' + datastore.data.contract.address)
                                                                }
                                                            } else {
                                                                utils.log('INDEXER CONTRACT NOT WORKING')
                                                                valid = false
                                                            }
                                                        } catch (e) {
                                                            utils.log('ERROR WHILE SEARCHING INDEXED CONTRACT', '', 'errors')
                                                            utils.log(e, '', 'errors')
                                                            valid = false
                                                        }
                                                    } else {
                                                        utils.log('INVALID REQUEST')
                                                        valid = false
                                                    }
                                                } else {
                                                    valid = false
                                                }
                                            } else {
                                                valid = false
                                            }
                                        }

                                        // CHECK TRANSACTION INPUTS
                                        if (datastore.data.transaction.inputs.length > 0 && !isExtended) {
                                            for (let x in datastore.data.transaction.inputs) {
                                                let sxid = datastore.data.transaction.inputs[x].sxid
                                                let vout = datastore.data.transaction.inputs[x].vout
                                                let validategenesis = await scwallet.validategenesis(sxid, datastore.data.transaction.sidechain)
                                                if (validategenesis === false) {
                                                    let validateinput = await scwallet.validateinput(sxid, vout, datastore.data.transaction.sidechain, datastore.address)
                                                    if (validateinput === false) {
                                                        valid = false
                                                        utils.log('INPUT ' + sxid + ':' + vout + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS INVALID.')
                                                    } else if (validateinput === true) {
                                                        let isDoubleSpended = await scwallet.checkdoublespending(sxid, vout, datastore.data.transaction.sidechain, datastore.data.sxid)
                                                        if (isDoubleSpended === true) {
                                                            valid = false
                                                            utils.log('INPUT ' + sxid + ':' + vout + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS A DOUBLE SPEND.')
                                                        }
                                                    }
                                                }
                                                // CHECKING GENESIS
                                                if (datastore.data.transaction.inputs[x].vout === 'genesis' || datastore.data.transaction.inputs[x].vout === 'reissue') {
                                                    isGenesis = true
                                                }
                                                if (check_sidechain[0].data.genesis !== undefined) {
                                                    if (valid === true && datastore.data.transaction.inputs[x].amount !== undefined) {
                                                        let fixed = math.round(datastore.data.transaction.inputs[x].amount, check_sidechain[0].data.genesis.decimals)
                                                        amountinput = math.sum(amountinput, fixed)
                                                    }
                                                } else {
                                                    valid = false
                                                    console.log('SIDECHAIN DOES NOT EXIST.')
                                                }
                                            }
                                        } else {
                                            valid = false
                                        }

                                        // FIXING AMOUNTS VALUES 
                                        if (check_sidechain[0].data.genesis !== undefined) {
                                            if (valid === true) {
                                                for (let x in datastore.data.transaction.outputs) {
                                                    let fixed = math.round(datastore.data.transaction.outputs[x], check_sidechain[0].data.genesis.decimals)
                                                    amountoutput = math.sum(amountoutput, fixed)
                                                }
                                            }
                                            amountoutput = math.round(amountoutput, check_sidechain[0].data.genesis.decimals)
                                            amountinput = math.round(amountinput, check_sidechain[0].data.genesis.decimals)
                                        } else {
                                            valid = false
                                            utils.log('THERE\'S NO GENESIS, TRANSACTION INVALID')
                                        }

                                        // CHECK OVERMINT
                                        if (!isGenesis && !isExtended) {
                                            if (valid === true && amountoutput > amountinput) {
                                                valid = false
                                                utils.log('AMOUNT IS INVALID IN SIDECHAIN TRANSACTION ' + datastore.data.transaction.sidechain + ' ' + datastore.data.sxid + ' AT BLOCK ' + datastore.block + ' > OUT:' + amountoutput + ' IN: ' + amountinput)
                                            }
                                        }

                                        // CHECK SIGNATURE
                                        var wallet = new Crypto.Wallet;
                                        let pubkey
                                        if (datastore.data.pubkey !== undefined) {
                                            pubkey = datastore.data.pubkey
                                        } else if (datastore.data.pubKey !== undefined) {
                                            pubkey = datastore.data.pubKey
                                        }
                                        if (valid === true && pubkey !== undefined && pubkey.length > 0 && datastore.data.signature !== undefined && datastore.data.transaction !== undefined) {
                                            let validatesign = await wallet.verifymessage(pubkey, datastore.data.signature, JSON.stringify(datastore.data.transaction))
                                            if (validatesign === false) {
                                                utils.log('TRANSACTION SIGN IS INVALID')
                                                valid = false
                                            }
                                        } else {
                                            utils.log('TRANSACTION IS NOT VALID')
                                            valid = false
                                        }

                                        // ALL VALID, INSERTING TRANSACTION IN DB
                                        if (valid === true) {
                                            utils.log('ALL TRANSACTIONS PASSED, STORING.')
                                            datastore.data.block = datastore.block
                                            let insertTx = false
                                            while (insertTx === false) {
                                                try {
                                                    let checkTx = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                                    if (checkTx[0] === undefined) {
                                                        await db.collection("sc_transactions").insertOne(datastore.data, { w: 1, j: true })
                                                        let checkinsertedTx = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                                        if (checkinsertedTx[0] !== undefined) {
                                                            insertTx = true
                                                        }
                                                    }else{
                                                        insertTx = true
                                                    }
                                                } catch (e) {
                                                    utils.log('ERROR WHILE INSERTING PLANUM TX', '', 'errors')
                                                    utils.log(e, '', 'errors')
                                                }
                                            }

                                            // REEDIMING UNSPENT FOR EACH INPUT
                                            for (let x in datastore.data.transaction.inputs) {
                                                if (datastore.data.transaction.inputs[x].sxid !== undefined && datastore.data.transaction.inputs[x].vout !== undefined) {
                                                    let sxid = datastore.data.transaction.inputs[x].sxid
                                                    let vout = datastore.data.transaction.inputs[x].vout
                                                    let updated = false
                                                    while (updated === false) {
                                                        try {
                                                            if (datastore.block !== null) {
                                                                await db.collection('sc_unspent').updateMany({ sxid: sxid, vout: vout }, { $set: { redeemed: datastore.data.sxid, redeemblock: datastore.block } }, { writeConcern: { w: 1, j: true } })
                                                            } else {
                                                                await db.collection('sc_unspent').updateMany({ sxid: sxid, vout: vout }, { $set: { redeemed: datastore.data.sxid } }, { writeConcern: { w: 1, j: true } })
                                                            }
                                                            let checkUnspentRedeemed = await db.collection('sc_unspent').find({ sxid: sxid, vout: vout }).limit(1).toArray()
                                                            if (checkUnspentRedeemed[0] !== undefined && checkUnspentRedeemed[0].redeemed === datastore.data.sxid) {
                                                                updated = true
                                                                utils.log('REDEEMING UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + sxid + ':' + vout + ' AT BLOCK ' + datastore.block)
                                                            } else {
                                                                utils.log('ERROR WHILE REDEEMING UNSPENT', '', 'errors')
                                                            }
                                                        } catch (e) {
                                                            utils.log('ERROR WHILE REDEEMING UNSPENT', '', 'errors')
                                                            utils.log(e)
                                                        }
                                                    }
                                                }
                                            }

                                            // CREATING UNSPENT FOR EACH VOUT
                                            let vout = 0
                                            for (let x in datastore.data.transaction.outputs) {
                                                utils.log('EVALUATING UNSPENT ' + datastore.data.sxid + ':' + vout + ' FOR ADDRESS ' + x)
                                                let amount = datastore.data.transaction.outputs[x]
                                                let unspent = {
                                                    txid: datastore.data.txid,
                                                    sxid: datastore.data.sxid,
                                                    vout: vout,
                                                    address: x,
                                                    amount: amount,
                                                    sidechain: datastore.data.transaction.sidechain,
                                                    block: datastore.block,
                                                    redeemed: null,
                                                    redeemblock: null,
                                                    time: datastore.data.transaction.time
                                                }
                                                let insertedUsxo = false
                                                while (insertedUsxo === false) {
                                                    try {
                                                        let checkUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                        if (checkUsxo[0] === undefined) {
                                                            utils.log('CREATING UNSPENT ' + datastore.data.sxid + ':' + vout + ' FOR ADDRESS ' + x)
                                                            await db.collection('sc_unspent').insertOne(unspent, { w: 1, j: true })
                                                            let checkInsertedUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                            if (checkInsertedUsxo[0] !== undefined) {
                                                                insertedUsxo = true
                                                            }
                                                        }else{
                                                            utils.log('WHY UNSPENT EXISTS YET?')
                                                            await db.collection('sc_unspent').deleteOne({ sxid: datastore.data.sxid, vout: vout }, { w: 1, j: true })
                                                            let checkInsertedUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                            if (checkInsertedUsxo[0] !== undefined) {
                                                                insertedUsxo = true
                                                            }
                                                        }
                                                    } catch (e) {
                                                        utils.log('ERROR WHILE INSERTING UNSPENT, RETRY.', '', 'errors')
                                                        utils.log(e)
                                                    }
                                                }
                                                vout++
                                            }
                                            utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS VALID')
                                            // TRANSACTION STORED CORRECTLY
                                        } else {
                                            utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS INVALID')
                                        }
                                    } else {
                                        // BE SURE WE'RE NOT IN MEMPOOL
                                        if (isMempool === false && block !== null) {
                                            // REEDIMING UNSPENT FOR EACH INPUT
                                            for (let x in datastore.data.transaction.inputs) {
                                                if (datastore.data.transaction.inputs[x].sxid !== undefined && datastore.data.transaction.inputs[x].vout !== undefined) {
                                                    let sxid = datastore.data.transaction.inputs[x].sxid
                                                    let vout = datastore.data.transaction.inputs[x].vout
                                                    let updated = false
                                                    while (updated === false) {
                                                        try {
                                                            if (datastore.block !== null) {
                                                                await db.collection('sc_unspent').updateMany({ sxid: sxid, vout: vout }, { $set: { redeemed: datastore.data.sxid, redeemblock: datastore.block } }, { writeConcern: { w: 1, j: true } })
                                                            } else {
                                                                await db.collection('sc_unspent').updateMany({ sxid: sxid, vout: vout }, { $set: { redeemed: datastore.data.sxid } }, { writeConcern: { w: 1, j: true } })
                                                            }
                                                            let checkUnspentRedeemed = await db.collection('sc_unspent').find({ sxid: sxid, vout: vout }).limit(1).toArray()
                                                            if (checkUnspentRedeemed[0] !== undefined && checkUnspentRedeemed[0].redeemed === datastore.data.sxid) {
                                                                updated = true
                                                                utils.log('REDEEMING UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + sxid + ':' + vout + ' AT BLOCK ' + datastore.block)
                                                            } else {
                                                                utils.log('ERROR WHILE REDEEMING UNSPENT', '', 'errors')
                                                            }
                                                        } catch (e) {
                                                            utils.log('ERROR WHILE REDEEMING UNSPENT', '', 'errors')
                                                            utils.log(e)
                                                        }
                                                    }
                                                }
                                            }

                                            // CREATING UNSPENT FOR EACH VOUT
                                            let vout = 0
                                            for (let x in datastore.data.transaction.outputs) {
                                                let amount = datastore.data.transaction.outputs[x]
                                                let unspent = {
                                                    txid: datastore.data.txid,
                                                    sxid: datastore.data.sxid,
                                                    vout: vout,
                                                    address: x,
                                                    amount: amount,
                                                    sidechain: datastore.data.transaction.sidechain,
                                                    block: datastore.block,
                                                    redeemed: null,
                                                    redeemblock: null,
                                                    time: datastore.data.transaction.time
                                                }
                                                let inserted = false
                                                while (inserted === false) {
                                                    try {
                                                        let checkUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                        if (checkUsxo[0] === undefined) {
                                                            utils.log('CREATING UNSPENT ' + datastore.data.sxid + ':' + vout + ' FOR ADDRESS ' + x)
                                                            await db.collection('sc_unspent').insertOne(unspent, { w: 1, j: true })
                                                            let checkInsertedUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                            if (checkInsertedUsxo[0] !== undefined) {
                                                                inserted = true
                                                            }
                                                        }else{
                                                            inserted = true
                                                        }
                                                    } catch (e) {
                                                        utils.log('ERROR WHILE INSERTING UNSPENT, RETRY.', '', 'errors')
                                                        utils.log(e)
                                                    }
                                                }
                                                vout++
                                            }
                                        }
                                    }
                                } else {
                                    console.log('SIDECHAIN DOESN\'T EXIST!')
                                }
                            }
                        }
                        client.close()
                        response('STORED')
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private async storereceived(datastore): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        let check = await db.collection('received').find({ txid: datastore.txid, address: datastore.address }).limit(1).toArray()
                        if (check[0] === undefined) {
                            console.log('STORING DATA NOW!')
                            try {
                                await db.collection("received").insertOne(datastore, { w: 1, j: true })
                                utils.log('RECEIVED DATA ' + JSON.stringify(datastore))
                            } catch (e) {
                                utils.log('DB ERROR', '', 'errors')
                                utils.log(e, '', 'errors')
                                client.close()
                                response(false)
                            }
                        } else {
                            utils.log('DATA ALREADY STORED.')
                            if (check[0].block === undefined || check[0].block === null) {
                                await db.collection("sc_transactions").updateMany({ txid: datastore.txid }, { $set: { block: datastore.block } }, { writeConcern: { w: 1, j: true } })
                            }
                        }
                        client.close()
                        response('STORED')
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        private consolidatestored() {
            return new Promise(async response => {
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        const utils = new Utilities.Parser
                        let checktxs = await db.collection('transactions').find({ blockhash: null }).toArray()
                        let now = new Date().getTime()
                        if (checktxs.length > 0) {
                            utils.log('FOUND ' + checktxs.length + ' TRANSACTIONS TO CONSOLIDATE')
                            for (let k in checktxs) {
                                let tx = checktxs[k]
                                let time = tx.inserted
                                let elapsed = (now - time) / 1000
                                if (elapsed > 600) {
                                    utils.log('ELAPSED ' + elapsed + 's, NEED TO CONSOLIDATE')
                                    var wallet = new Crypto.Wallet
                                    let rawtransaction = await wallet.request('getrawtransaction', [tx.txid, 1])
                                    let txvalid = true
                                    let block

                                    if (rawtransaction['result'] !== undefined) {
                                        let rawtx = rawtransaction['result']
                                        if (rawtx !== null && rawtx['blockhash'] !== undefined) {
                                            let getblock = await wallet.request('getblock', [rawtx['blockhash']])
                                            if (getblock['result'] !== undefined) {
                                                block = getblock['result']
                                            } else {
                                                txvalid = false
                                            }
                                        } else {
                                            txvalid = false
                                        }
                                    } else {
                                        txvalid = false
                                    }

                                    if (txvalid === true && block['height'] !== undefined && block['hash'] !== undefined && block['time'] !== undefined) {
                                        utils.log('SUCCESSFULLY CONSOLIDATED TRANSACTION ' + tx.address + ':' + tx.txid + '!')
                                        try {
                                            await db.collection("transactions").updateOne({
                                                address: tx.address, txid: tx.txid
                                            }, {
                                                $set: {
                                                    blockheight: block['height'],
                                                    blockhash: block['hash'],
                                                    time: block['time']
                                                }
                                            }, { upsert: true, writeConcern: { w: 1, j: true } })
                                        } catch (e) {
                                            utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                            utils.log(e)
                                        }
                                    } else {
                                        utils.log('TRANSACTION NOT FOUND, DELETE EVERYTHING RELATED')
                                        try {
                                            await db.collection('sc_unspent').deleteMany({ txid: tx.txid })
                                            await db.collection('sc_transactions').deleteMany({ txid: tx.txid })
                                            await db.collection('unspent').deleteMany({ txid: tx.txid })
                                            await db.collection('transactions').deleteMany({ txid: tx.txid })
                                            await db.collection('received').deleteMany({ txid: tx.txid })
                                            await db.collection('written').deleteMany({ txid: tx.txid })
                                        } catch (e) {
                                            utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                            utils.log(e)
                                        }
                                    }
                                } else {
                                    utils.log('ELAPSED ' + elapsed + 's, EARLY TRANSACTION')
                                }
                            }
                            client.close()
                        } else {
                            client.close()
                        }
                        response(true)
                    })
                } catch (e) {
                    let utils = new Utilities.Parser
                    utils.log('ERROR WHILE CONSOLIDATE', '', 'errors')
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }
    }

}

export = Daemon