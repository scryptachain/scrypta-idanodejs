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
            if (global['isSyncing'] === false && !fs.existsSync('.BOOTSTRAPPING')) {
                var wallet = new Crypto.Wallet
                // console.clear()
                global['retrySync'] = 0
                wallet.request('getinfo').then(info => {
                    blocks = info['result'].blocks
                    let utils = new Utilities.Parser
                    utils.log('FOUND ' + blocks + ' BLOCKS IN THE BLOCKCHAIN')
                    let task = new Daemon.Sync
                    task.process()
                })
            } else {
                if (!fs.existsSync('.BOOTSTRAPPING')) {
                    console.log('\x1b[41m%s\x1b[0m', 'CAN\'T INIT, IDANODE IS SYNCING YET!')
                } else {
                    console.log('\x1b[41m%s\x1b[0m', 'BOOTSTRAP IN PROCESS, PLEASE WAIT')
                }
            }
        }

        public async process() {
            if (global['isSyncing'] === false && !fs.existsSync('.BOOTSTRAPPING')) {
                let utils = new Utilities.Parser

                // CHECK IF THERE ARE PINNED CONTRACTS
                let contracts = new Contracts.Local
                let pinned = await contracts.pinned()

                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        global['retrySync'] = 0
                        global['isSyncing'] = true
                        let task = new Daemon.Sync
                        const sync = await db.collection('blocks').find().sort({ block: -1 }).limit(2).toArray()
                        var last
                        if (sync[0] === undefined) {
                            utils.log('Sync lock not found, creating')
                            await db.collection('blocks').insertOne({ block: 0, time: new Date().getTime() }, { w: 1, j: true });
                            last = 0
                        } else {
                            last = sync[0].block
                            let continuitycheck = last - 1
                            if (sync[1] !== undefined && sync[1] !== null && continuitycheck !== sync[1].block) {
                                last = continuitycheck - 1
                            }
                            if (sync[1] !== undefined && sync[1] !== null && sync[0].block === sync[1].block) {
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

                            // CONSOLIDATING PLANUM TRANSACTIONS
                            utils.log('CONSOLIDATING PLANUM TRANSACTIONS')
                            let consolidateErrors = false
                            try {
                                await task.consolidateplanum()
                            } catch (e) {
                                utils.log('ERROR WHILE CONSOLIDATING', '', 'errors')
                                utils.log(e, '', 'errors')
                                consolidateErrors = true
                            }
                            if (!consolidateErrors) {
                                console.log('\x1b[31m%s\x1b[0m', 'ANALYZING MEMPOOL')
                                var wallet = new Crypto.Wallet
                                var mempool = await wallet.analyzeMempool()
                                if (mempool !== false) {
                                    global['retrySync'] = 0
                                    for (var address in mempool['data_written']) {
                                        var data = mempool['data_written'][address]
                                        console.log('\x1b[32m%s\x1b[0m', 'FOUND GENERIC DATA FOR ' + address + '.')
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

                                    let redeemed = []
                                    for (var i in mempool['inputs']) {
                                        let input = mempool['inputs'][i]
                                        if (redeemed.indexOf(input['txid'] + ':' + input['vout']) === -1) {
                                            let redeemunspent = await task.redeemunspent(input['txid'], input['vout'], null)
                                            if (redeemunspent !== false) {
                                                redeemed.push(input['txid'] + ':' + input['vout'])
                                            }
                                        }
                                    }

                                    if ((mempool['outputs'].length > 0 || mempool['data_written'].length > 0 || mempool['data_received'].length > 0) && pinned.length > 0) {
                                        for (let k in pinned) {
                                            let contract = pinned[k]
                                            console.log('CHECKING ' + contract.contract + ' FOR IFMEMPOOL FUNCTION')
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
                        }

                        if (analyze <= blocks) {
                            global['remainingBlocks'] = remains
                            global['chunkretain']++
                            if(global['chunkretain'] > 10){
                                global['chunkcache'] = []
                            }
                            let errors = false
                            if (remains === 0) {
                                // CONSOLIDATING TRANSACTIONS WITHOUT CONFIRMS FIRST
                                try {
                                    await task.consolidatestored()
                                } catch (e) {
                                    utils.log('ERROR WHILE CONSOLIDATING', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    await scrypta.sleep(2000)
                                    global['isSyncing'] = false
                                    errors = true
                                }
                            }
                            if (global['syncLock'] === false && errors === false) {
                                let utils = new Utilities.Parser
                                try {
                                    let synced: any = false
                                    while (synced === false) {
                                        console.log('STARTING ANALYZING BLOCK')
                                        try {
                                            synced = await task.analyze()
                                        } catch (e) {
                                            utils.log('ERROR WHILE ANALYZING BLOCK', '', 'errors')
                                            utils.log(e)
                                        }
                                        console.log('SYNCING FINISHED')
                                        if (synced !== false && parseInt(synced) > 0) {
                                            global['retrySync'] = 0
                                            utils.log('SUCCESSFULLY SYNCED BLOCK ' + synced, '\x1b[46m%s\x1b[0m')
                                            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                                                utils.log('SAVING BLOCK ' + synced)
                                                if (!err) {
                                                    var db = client.db(global['db_name'])
                                                    let saved = false
                                                    while (saved === false) {
                                                        utils.log('TRYING SAVE BLOCK ' + synced)
                                                        try {
                                                            await db.collection('blocks').insertOne({ block: synced, time: new Date().getTime() }, { w: 1, j: true })
                                                            let savecheck = await db.collection('blocks').find({ block: synced }).toArray()
                                                            if (savecheck[0] !== undefined && savecheck[0].block === synced) {
                                                                saved = true
                                                                utils.log('BLOCK SAVED SUCCESSFULLY')
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
                                                } else {
                                                    console.log(err)
                                                    global['isSyncing'] = false
                                                    setTimeout(function () {
                                                        task.process()
                                                    }, 10)
                                                }
                                            })
                                        } else if (synced === 'RESTART') {
                                            global['isSyncing'] = false
                                            synced = true
                                            utils.log('SIDECHAIN NOT WORKING, RESTARTING PROCESS.', '\x1b[41m%s\x1b[0m', 'errors')
                                            await scrypta.sleep(2000)
                                            setTimeout(function () {
                                                task.process()
                                            }, 10)
                                        } else {
                                            utils.log('BLOCK NOT SYNCED, RETRY.', '\x1b[41m%s\x1b[0m', 'errors')
                                            await scrypta.sleep(2000)
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
                        client.close()
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    global['isSyncing'] = false
                    setTimeout(function () {
                        let task = new Daemon.Sync
                        task.process()
                    }, 1000)
                }
            } else {
                if (!fs.existsSync('.BOOTSTRAPPING')) {
                    console.log('\x1b[41m%s\x1b[0m', 'CAN\'T INIT, IDANODE IS SYNCING YET!')
                } else {
                    console.log('\x1b[41m%s\x1b[0m', 'BOOTSTRAP IN PROCESS, PLEASE WAIT')
                }
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
                        let start = new Date().getTime()
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
                                let redeemed = []
                                let task = new Daemon.Sync
                                for (let ji in block['analysis']) {

                                    // STORING OUTPUTS
                                    for (var i in block['analysis'][ji]['outputs']) {
                                        let unspent = block['analysis'][ji]['outputs'][i]
                                        var found = false
                                        for (var i in block['analysis'][ji]['inputs']) {
                                            let input = block['analysis'][ji]['inputs'][i]
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

                                    // REDEEMING INPUTS
                                    for (var i in block['analysis'][ji]['inputs']) {
                                        let input = block['analysis'][ji]['inputs'][i]
                                        if (redeemed.indexOf(input['txid'] + ':' + input['vout']) === -1) {
                                            let redeemedunspent = await task.redeemunspent(input['txid'], input['vout'], analyze)
                                            if (redeemedunspent === false) {
                                                utils.log('ERROR ON REDEEM UNSPENT')
                                                response(false)
                                            } else {
                                                redeemed.push(input['txid'] + ':' + input['vout'])
                                            }
                                        }
                                    }

                                    // STORING TRANSACTIONS
                                    for (var address in block['analysis'][ji]['balances']) {
                                        var tx = block['analysis'][ji]['balances'][address]
                                        let txid = block['analysis'][ji]['txid']
                                        var movements = block['analysis'][ji]['movements']
                                        console.log('STORING ' + tx.type + ' OF ' + tx.value + ' ' + process.env.COIN + ' FOR ADDRESS ' + address)
                                        let storedtx = await task.store(address, block, txid, tx, movements)
                                        if (storedtx === false) {
                                            utils.log('ERROR ON STORE TRANSACTION')
                                            response(false)
                                        }
                                    }

                                }

                                // console.log('CLEANING UTXO CACHE')
                                global['utxocache'] = []
                                global['txidcache'] = []
                                // console.log('CLEANING USXO CACHE')
                                global['usxocache'] = []
                                global['sxidcache'] = []
                                global['valid_txs_block'] = []
                                
                                // STORE PLANUM DATA
                                if (block['planum'].length > 0) {
                                    let sidechains = []
                                    for (var dix in block['planum']) {
                                        utils.log('FOUND PLANUM TX.', '\x1b[32m%s\x1b[0m')
                                        let task = new Daemon.Sync
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
                                        while (storedplanum === false) {
                                            try {
                                                storedplanum = await task.storeplanum(block['planum'][dix], false, block['height'])
                                                utils.log('STORE PLANUM RESPONSE IS ' + storedplanum)
                                                if (storedplanum === false) {
                                                    utils.log('ERROR STORING PLANUM', '', 'errors')
                                                } else if (storedplanum === true) {
                                                    if (block['planum'][dix]['data'] !== undefined && block['planum'][dix]['data']['transaction'] !== undefined && block['planum'][dix]['data']['transaction']['sidechain'] !== undefined) {
                                                        if (sidechains.indexOf(block['planum'][dix]['data']['transaction']['sidechain']) === -1) {
                                                            sidechains.push(block['planum'][dix]['data']['transaction']['sidechain'])
                                                        }
                                                    }
                                                }
                                            } catch (e) {
                                                storedplanum = false
                                                utils.log('ERROR STORING PLANUM DATA ON PLANUM', '', 'errors')
                                            }
                                        }
                                    }

                                    if (process.env.PINNED_SIDECHAINS !== 'NO') {
                                        let pinned_sidechains = []
                                        if(process.env.PINNED_SIDECHAINS !== undefined){
                                            pinned_sidechains = process.env.PINNED_SIDECHAINS.split(',')
                                            utils.log('CHECK ' + sidechains.length + ' / ' + pinned_sidechains.length + ' CHANGED SIDECHAINS')
                                        }else{
                                            process.env.PINNED_SIDECHAINS = 'ALL'
                                            utils.log('CHECK ' + sidechains.length + ' CHANGED SIDECHAINS')
                                        }
                                        for (let sxi in sidechains) {
                                            let sidechain = sidechains[sxi]
                                            let shouldCheck = false
                                            if (pinned_sidechains.length > 0) {
                                                if (pinned_sidechains.indexOf(sidechain) !== -1) {
                                                    shouldCheck = true
                                                }else if(process.env.PINNED_SIDECHAINS === 'ALL'){
                                                    shouldCheck = true
                                                }
                                            } else if (process.env.PINNED_SIDECHAINS !== 'NO') {
                                                shouldCheck = true
                                            }
                                            if (shouldCheck) {
                                                utils.log('START CHECKING ' + sidechain)
                                                let checked = false
                                                let validated = false
                                                while (checked === false) {
                                                    try {
                                                        let resultvalidation = await task.checkplanum(sidechain)
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
                                                            cleaned = await task.cleanplanum(global['valid_txs_block'], block['height'])
                                                        } catch (e) {
                                                            utils.log('ERROR CLEANING PLANUM', '', 'errors')
                                                        }
                                                    }
                                                    await task.deleteLastBlock()
                                                    utils.log('ERROR WHILE STORING SIDECHAINS TRANSACTIONS, NOW IS INVALID, RETRY SYNC BLOCK.', '', 'errors')
                                                    response('RESTART')
                                                } else {
                                                    global['restartSync'] = 0
                                                    utils.log('SIDECHAIN ' + sidechain + ' SUCCESSFULLY VALIDATED AFTER CHANGE', '\x1b[32m%s\x1b[0m')
                                                }
                                            }
                                        }
                                    }
                                }

                                // STORE OTHER DATA
                                for (var address in block['data_written']) {
                                    var data = block['data_written'][address]
                                    console.log('\x1b[32m%s\x1b[0m', 'FOUND GENERIC DATA FOR ' + address + '.')
                                    for (var dix in data) {
                                        if (data[dix].protocol !== 'chain://') {
                                            let task = new Daemon.Sync
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
                                        let task = new Daemon.Sync
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
                                    console.log('CHECKING CONTRACTS')
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
                                let end = new Date().getTime()
                                let elapsed = (end - start) / 1000
                                utils.log('ELAPSED ' + elapsed + 's TO SYNC BLOCK ' + block['height'], '', 'log')
                                response(block['height'])
                            } else {
                                global['isAnalyzing'] = false
                                utils.log('ERROR, ANALYZING BLOCK FAILED', '', 'errors')
                                setTimeout(function () {
                                    let task = new Daemon.Sync
                                    task.process()
                                }, 500)
                                response(false)
                            }
                        } else {
                            global['isAnalyzing'] = false
                            utils.log('ERROR, CAN\'T GET BLOCK DETAILS', '', 'errors')
                            setTimeout(function () {
                                let task = new Daemon.Sync
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

        private async deleteLastBlock() {
            return new Promise(async response => {
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    var db = client.db(global['db_name'])
                    global['restartSync'] = global['restartSync'] + 1
                    let lasts = await db.collection('blocks').find().sort({ block: -1 }).limit(global['restartSync']).toArray()
                    for (let k in lasts) {
                        let last = lasts[k]
                        await db.collection('blocks').deleteOne({ block: last.block })
                    }
                    client.close()
                    response(true)
                })
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
                            let stored = false
                            let retries = 0
                            while (!stored) {
                                try {
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
                                    let checkStored = await db.collection('transactions').find({ address: address, txid: txid }).limit(1).toArray()
                                    if (checkStored[0] !== undefined) {
                                        stored = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        stored = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    console.log(e)
                                    utils.log('ERROR WHILE STORING TRANSACTION')
                                    retries++
                                    if (retries > 10) {
                                        stored = true
                                        client.close()
                                        response(false)
                                    }
                                }
                            }
                        } else if (check[0].blockheight === null && block['height'] !== undefined) {
                            let updated = false
                            let retries = 0
                            while (!updated) {
                                try {
                                    await db.collection("transactions").updateOne({
                                        address: address, txid: txid
                                    }, {
                                        $set: {
                                            blockheight: block['height'],
                                            blockhash: block['hash'],
                                            time: block['time']
                                        }
                                    }, { writeConcern: { w: 1, j: true } })
                                    let checkUpdated = await db.collection('transactions').find({ address: address, txid: txid }).limit(1).toArray()
                                    if (checkUpdated[0] !== undefined && checkUpdated[0].blockheight === block['height'] && checkUpdated[0].blockhash === block['hash'] && checkUpdated[0].time === block['time']) {
                                        updated = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        updated = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('ERROR WHILE UPDATING TRANSACTION')
                                }
                            }
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
                            let insertUnspent = false
                            let retries = 0
                            while (!insertUnspent) {
                                try {
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
                                    let checkInsertUnspent = await db.collection("unspent").find({ txid: txid, vout: vout }).limit(1).toArray()
                                    if (checkInsertUnspent[0] !== undefined) {
                                        insertUnspent = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        insertUnspent = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('ERROR WHILE STORING UNSPENT!')
                                }
                            }
                        } else if (check[0].block === null && block !== null) {
                            let updateUnspent = false
                            let retries = 0
                            while (!updateUnspent) {
                                try {
                                    console.log('\x1b[36m%s\x1b[0m', 'UPDATING BLOCK NOW!')
                                    await db.collection("unspent").updateOne({ txid: txid, vout: vout }, { $set: { block: block } }, { writeConcern: { w: 1, j: true } })
                                    let checkUpdateUnspent = await db.collection("unspent").find({ txid: txid, vout: vout }).limit(1).toArray()
                                    if (checkUpdateUnspent[0] !== undefined) {
                                        updateUnspent = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        updateUnspent = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('ERROR WHILE UPDATING BLOCK IN UNSPENT')
                                }
                            }
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
                    console.log('\x1b[31m%s\x1b[0m', 'REDEEMING UNSPENT ' + txid + ':' + vout)
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (!err) {
                            let redeemed = false
                            let retries = 0
                            while (redeemed === false) {
                                var db = client.db(global['db_name'])
                                try {
                                    let updated = await db.collection('unspent').updateOne({ txid: txid, vout: vout }, { $set: { redeemblock: block, redeemed: txid } }, { w: 1, j: true })
                                    if (updated.result !== undefined && updated.result.ok !== undefined && updated.result.ok === 1) {
                                        redeemed = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        redeemed = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    console.log(e)
                                }
                            }
                            client.close()
                            response(true)
                        } else {
                            client.close()
                            response(false)
                        }
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

        // STORE WRITTEN - COLLECT FUNCTION
        private async storewritten(datastore, isMempool = false, block = null): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    datastore.block = block
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (!err && client !== undefined) {
                            var db = client.db(global['db_name'])
                            let check = await db.collection('written').find({ uuid: datastore.uuid, block: datastore.block }).limit(1).toArray()
                            if (check[0] === undefined) {
                                console.log('STORING DATA NOW!')
                                utils.log('WRITTEN DATA ' + JSON.stringify(datastore))

                                // IPFS SPECIFIC
                                if (JSON.stringify(datastore.data).indexOf('ipfs:') !== -1) {
                                    let parsed = datastore.data.split('***')
                                    if (parsed[0] !== undefined && process.env.PINIPFS === 'true') {
                                        let parsehash = parsed[0].split(':')
                                        if (parsehash[1] !== undefined && parsehash[1] !== 'undefined') {
                                            console.log('\x1b[42m%s\x1b[0m', 'PINNING IPFS HASH ' + parsehash[1])
                                            global['ipfs'].pin.add(parsehash[1], function (err) {
                                                if (err) {
                                                    response(false)
                                                }
                                            })
                                        }
                                    }
                                }

                                // BVC SPECIFIC
                                if (datastore.protocol === 'bvc://' && global['pinipfs'] === true) {
                                    let task = new Daemon.Sync
                                    await task.pinipfsfolder(datastore.data)
                                }

                                // PLANUM PERMISSIONED ALLOW USER SPECIFIC
                                if (datastore.protocol === 'scallow://') {
                                    let task = new Daemon.Sync
                                    await task.storeallowdata(datastore)
                                }

                                // PLANUM PERMISSIONED DENY USER SPECIFIC
                                if (datastore.protocol === 'scdeny://') {
                                    let task = new Daemon.Sync
                                    await task.storedenydata(datastore)
                                }

                                // DOCUMENTA SPECIFIC
                                if (datastore.protocol === 'documenta://') {
                                    let task = new Daemon.Sync
                                    await task.storedocumentadata(datastore)
                                }

                                // STORE GENERIC DATA
                                if (datastore.uuid !== undefined && datastore.uuid !== '') {
                                    let task = new Daemon.Sync
                                    console.log('STORING GENERIC DATA')
                                    await task.storewrittendata(datastore)
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
                        } else {
                            response(false)
                        }
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        // GENERIC DATA
        private async storewrittendata(datastore): Promise<any> {
            return new Promise(response => {
                const utils = new Utilities.Parser
                let insertedWritten = false
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    if (!err && client !== undefined) {
                        var db = client.db(global['db_name'])
                        if (db) {
                            let retries = 0
                            while (insertedWritten === false) {
                                try {
                                    await db.collection("written").insertOne(datastore, { w: 1, j: true })
                                    let checkWritten = await db.collection('written').find({ uuid: datastore.uuid }).limit(1).toArray()
                                    if (checkWritten[0] !== undefined) {
                                        insertedWritten = true
                                    }
                                    retries++
                                    if (retries > 10) {
                                        insertedWritten = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('DB ERROR WHILE STORING WRITTEN', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                    retries++
                                    if (retries > 10) {
                                        insertedWritten = true
                                        client.close()
                                        response(false)
                                    }
                                    response(false)
                                }
                            }
                            client.close()
                            response(true)
                        } else {
                            response(false)
                        }
                    } else {
                        response(false)
                    }
                })
            })
        }

        // DOCUMENTA DATA
        private async storedocumentadata(datastore): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
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
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        if (!err && client !== undefined) {
                            var db = client.db(global['db_name'])
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
                                    utils.log('DB ERROR WHILE STORING DOCUMENTA', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                }
                            } else {
                                await db.collection("documenta").updateOne({ file: file.file }, { $set: { block: datastore.block } }, { writeConcern: { w: 1, j: true } })
                                console.log('FILE STORED YET')
                            }
                            client.close()
                            response(true)
                        } else {
                            response(false)
                        }
                    })
                } else {
                    response(false)
                }
            })
        }

        // PLANUM DATA
        private async storeallowdata(datastore): Promise<any> {
            return new Promise(response => {
                const utils = new Utilities.Parser
                let inserted = false
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    if (!err && client !== undefined) {
                        var db = client.db(global['db_name'])
                        if (db) {
                            let retries = 0
                            while (inserted === false) {
                                try {
                                    let parse = datastore.data.split('@')
                                    let sidechain = parse[1]
                                    let parseUser = parse[0].split(':')
                                    let role = parseUser[0]
                                    let user = parseUser[1]
                                    if (user !== undefined && role !== undefined && sidechain !== undefined) {
                                        let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true }, "data.genesis.version": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                                        if (check_sidechain[0].data.genesis.permissioned === true) {
                                            let checkPermissions = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                            if (checkPermissions[0] === undefined) {
                                                await db.collection("sc_permissions").insertOne({ sidechain: sidechain, users: [], validators: [] }, { w: 1, j: true })
                                                checkPermissions = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                            }
                                            // CHECK IF ACCOUNT IS ALLOWED TO CHANGE STATUS
                                            if (datastore.address === check_sidechain[0].data.genesis.owner || checkPermissions[0].validators.indexOf(datastore.address) !== -1) {
                                                let toUpdate = checkPermissions[0]
                                                let field = ''
                                                let canUpdate = true
                                                if (role === 'user') {
                                                    field = 'users'
                                                } else if (role === 'validator') {
                                                    field = 'validators'
                                                    if (datastore.address !== check_sidechain[0].data.genesis.owner) {
                                                        canUpdate = false
                                                    }
                                                }
                                                if (field !== '' && canUpdate === true) {
                                                    if (toUpdate[field].indexOf(user) === -1) {
                                                        toUpdate[field].push(user)
                                                        await db.collection("sc_permissions").updateOne({ sidechain: sidechain }, { $set: { users: toUpdate.users, validators: toUpdate.validators } }, { writeConcern: { w: 1, j: true } })
                                                        let checkUpdated = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                                        if (checkUpdated[0] !== undefined && checkUpdated[0].usres === toUpdate.users && checkUpdated[0].validators === toUpdate.validators) {
                                                            inserted = true
                                                            response(true)
                                                        }
                                                        retries++
                                                        if (retries > 10) {
                                                            inserted = true
                                                            client.close()
                                                            response(false)
                                                        }
                                                    } else {
                                                        // NOTHING TO DO
                                                        inserted = true
                                                        client.close()
                                                        response(true)
                                                    }
                                                } else {
                                                    // ROLE NOT RECONIZED
                                                    inserted = true
                                                    response(false)
                                                }
                                            } else {
                                                // ACCOUNT IS NOT ALLOWED TO CHANGE PERMISSIONS
                                                inserted = true
                                                response(false)
                                            }
                                        } else {
                                            // SIDECHAIN IS NOT PERMISSIONED
                                            inserted = true
                                            client.close()
                                            response(false)
                                        }
                                    } else {
                                        // ALLOW DATA MALFORMED
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('DB ERROR WHILE STORING ALLOW DATA', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                    retries++
                                    if (retries > 10) {
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                    response(false)
                                }
                            }
                            client.close()
                        } else {
                            response(false)
                        }
                    } else {
                        response(false)
                    }
                })
            })
        }

        private async storedenydata(datastore): Promise<any> {
            return new Promise(response => {
                const utils = new Utilities.Parser
                let inserted = false
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    if (!err && client !== undefined) {
                        var db = client.db(global['db_name'])
                        if (db) {
                            let retries = 0
                            while (inserted === false) {
                                try {
                                    let parse = datastore.data.split('@')
                                    let sidechain = parse[1]
                                    let parseUser = parse[0].split(':')
                                    let role = parseUser[0]
                                    let user = parseUser[1]
                                    if (user !== undefined && role !== undefined && sidechain !== undefined) {
                                        let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true }, "data.genesis.version": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                                        if (check_sidechain[0].data.genesis.permissioned === true) {
                                            let checkPermissions = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                            if (checkPermissions[0] === undefined) {
                                                await db.collection("sc_permissions").insertOne({ sidechain: sidechain, users: [], validators: [] }, { w: 1, j: true })
                                                checkPermissions = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                            }
                                            // CHECK IF ACCOUNT IS ALLOWED TO CHANGE STATUS
                                            if (datastore.address === check_sidechain[0].data.genesis.owner || checkPermissions[0].validators.indexOf(datastore.address) !== -1) {
                                                let toUpdate = checkPermissions[0]
                                                let field = ''
                                                if (role === 'user') {
                                                    field = 'users'
                                                } else if (role === 'validator') {
                                                    field = 'validators'
                                                }
                                                if (field !== '') {
                                                    if (toUpdate[field].indexOf(user) !== -1) {
                                                        let old = toUpdate[field]
                                                        toUpdate[field] = []
                                                        for (let k in old) {
                                                            if (old[k] !== user) {
                                                                toUpdate[field].push(old[k])
                                                            }
                                                        }
                                                        await db.collection("sc_permissions").updateOne({ sidechain: sidechain }, { $set: { users: toUpdate.users, validators: toUpdate.validators } }, { writeConcern: { w: 1, j: true } })
                                                        let checkUpdated = await db.collection('sc_permissions').find({ sidechain: sidechain }).limit(1).toArray()
                                                        if (checkUpdated[0] !== undefined && checkUpdated[0].usres === toUpdate.users && checkUpdated[0].validators === toUpdate.validators) {
                                                            inserted = true
                                                            response(true)
                                                        }
                                                        retries++
                                                        if (retries > 10) {
                                                            inserted = true
                                                            client.close()
                                                            response(false)
                                                        }
                                                    } else {
                                                        // NOTHING TO DO
                                                        inserted = true
                                                        client.close()
                                                        response(true)
                                                    }
                                                } else {
                                                    // ROLE NOT RECONIZED
                                                    inserted = true
                                                    response(false)
                                                }
                                            } else {
                                                // ACCOUNT IS NOT ALLOWED TO CHANGE PERMISSIONS
                                                inserted = true
                                                response(false)
                                            }
                                        } else {
                                            // SIDECHAIN IS NOT PERMISSIONED
                                            inserted = true
                                            client.close()
                                            response(false)
                                        }
                                    } else {
                                        // ALLOW DATA MALFORMED
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                } catch (e) {
                                    utils.log('DB ERROR WHILE STORING ALLOW DATA', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                    retries++
                                    if (retries > 10) {
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                    response(false)
                                }
                            }
                            client.close()
                        } else {
                            response(false)
                        }
                    } else {
                        response(false)
                    }
                })
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
                                    if (datastore.data !== undefined && datastore.data.transaction !== undefined) {
                                        for (let x in datastore.data.transaction.inputs) {
                                            let sxid = datastore.data.transaction.inputs[x].sxid
                                            let vout = datastore.data.transaction.inputs[x].vout
                                            if (sidechains.indexOf(datastore.data.transaction.sidechain) === -1) {
                                                sidechains.push(datastore.data.transaction.sidechain)
                                            }
                                            try {
                                                await db.collection('sc_unspent').updateOne({ sxid: sxid, vout: vout }, { $set: { redeemed: null, redeemblock: null } }, { writeConcern: { w: 1, j: true } })
                                            } catch (e) {
                                                console.log(e)
                                                utils.log('CLEAN ERROR ON BLOCK WHILE UPDATING INPUTS', '', 'errors')
                                                client.close()
                                                response(false)
                                            }
                                        }
                                    }
                                }
                                utils.log('CLEANING SIDECHAINS ' + JSON.stringify(sidechains))
                                for (let k in sidechains) {
                                    let sidechain = sidechains[k]
                                    utils.log('CLEANING ' + sidechain, '', 'log')
                                    try {
                                        await db.collection('sc_transactions').deleteMany({ "transaction": { $exists: true }, "transaction.sidechain": sidechain, block: null }, { writeConcern: { w: 1, j: true } })
                                        await db.collection('sc_unspent').deleteMany({ sidechain: sidechain, block: null }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        console.log(e)
                                        utils.log('CLEAN ERROR ON BLOCK WHILE DELETING MEMPOOL TRANSACTIONS', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('sc_transactions').deleteMany({ "transaction": { $exists: true }, "transaction.sidechain": sidechain, block: blockheight }, { writeConcern: { w: 1, j: true } })
                                        await db.collection('sc_unspent').deleteMany({ sidechain: sidechain, block: blockheight }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        console.log(e)
                                        utils.log('CLEAN ERROR ON BLOCK WHILE DELETING CONFIRMED TRANSACTIONS', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('written').deleteMany({ "data.transaction": { $exists: true }, "data.transaction.sidechain": sidechain, block: null }, { writeConcern: { w: 1, j: true } })
                                        await db.collection('written').deleteMany({ "data.transaction": { $exists: true }, "data.transaction.sidechain": sidechain, block: blockheight }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        console.log(e)
                                        utils.log('CLEAN ERROR ON BLOCK WHILE DELETING WRITTEN DATA', '', 'errors')
                                        client.close()
                                        response(false)
                                    }

                                    try {
                                        await db.collection('sc_transactions').deleteMany({ "transaction": { $exists: true }, "transaction.sidechain": sidechain, block: { $gt: blockheight } }, { writeConcern: { w: 1, j: true } })
                                        await db.collection('sc_unspent').deleteMany({ sidechain: sidechain, block: { $gt: blockheight } }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        console.log(e)
                                        utils.log('CLEAN ERROR ON BLOCK WHILE DELETING CONFIRMED UNSPENTS', '', 'errors')
                                        client.close()
                                        response(false)
                                    }
                                }
                                utils.log('CLEAN SUCCESS ON BLOCK', '', 'log')
                                client.close()
                                response(true)
                            } catch (e) {
                                console.log(e)
                                utils.log('CLEANING ERROR GENERAL', '', 'errors')
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
                            let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true }, "data.genesis.version": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
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
                                client.close()
                                if (cap !== issued) {
                                    response({ checked: true, validated: false })
                                } else {
                                    response({ checked: true, validated: true })
                                }
                            } else {
                                // SIDECHAIN DOESN'T EXISTS, TRANSACTIONS ARE INVALID
                                client.close()
                                response({ checked: true, validated: true })
                            }
                        } else {
                            // DB ERROR, RETRY
                            client.close()
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
                        } else {
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
                                            await db.collection("sc_transactions").updateOne({ sxid: datastore.data.sxid }, { $set: { block: datastore.block } }, { writeConcern: { w: 1, j: true } })
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
                                            await db.collection("sc_transactions").updateOne({ sxid: datastore.data.sxid }, { $set: { block: datastore.block } }, { writeConcern: { w: 1, j: true } })
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

                                            // CHECK IF SIDECHAIN IS PERMISSIONED, IF YES CHECK IF USERS ARE ALLOWED TO OPERATE
                                            if (check_sidechain[0].data.genesis.permissioned !== undefined && check_sidechain[0].data.genesis.permissioned === true) {
                                                utils.log('FOUND PERMISSIONED TRANSACTION')
                                                // VERIFYING INPUTS
                                                for (let k in datastore.data.transaction.inputs) {
                                                    let input = datastore.data.transaction.inputs[k]
                                                    let validated = await scwallet.validatepermissionedinput(input)
                                                    utils.log('INPUT RESPONSE IS ' + validated)
                                                    if (validated === false) {
                                                        valid = false
                                                    }
                                                }
                                                // VERIFYING OUTPUTS
                                                for (let address in datastore.data.transaction.outputs) {
                                                    if (valid) {
                                                        let validated = await scwallet.validateoutputaddress(address, datastore.data.transaction.sidechain)
                                                        utils.log('OUTPUT RESPONSE IS ' + validated)
                                                        if (validated === false) {
                                                            valid = false
                                                        }
                                                    }
                                                }
                                            }

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
                                                    let inputtime = datastore.data.transaction.inputs[x].time
                                                    let validategenesis = await scwallet.validategenesis(sxid, datastore.data.transaction.sidechain)
                                                    if (validategenesis === false) {
                                                        let validateinput = await scwallet.validateinput(sxid, vout, datastore.data.transaction.sidechain, datastore.address, datastore.data.sxid)
                                                        if (validateinput === false) {
                                                            valid = false
                                                            utils.log('INPUT ' + sxid + ':' + vout + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS NOT VALID.', '', 'errors')
                                                        } else if (validateinput === true) {
                                                            let isDoubleSpended = await scwallet.checkdoublespending(sxid, vout, datastore.data.transaction.sidechain, datastore.data.sxid)
                                                            if (isDoubleSpended === true) {
                                                                valid = false
                                                                utils.log('INPUT ' + sxid + ':' + vout + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS A DOUBLE SPEND.')
                                                            } else if (isDoubleSpended === false) {
                                                                if (inputtime > datastore.data.transaction.time) {
                                                                    valid = false
                                                                    utils.log('TIME FOR INPUT ' + sxid + ':' + vout + ' IS NOT VALID, CAN\'T BE SPENT BEFORE ' + inputtime + '.', '', 'errors')
                                                                } else {
                                                                    utils.log('TIME FOR INPUT ' + sxid + ':' + vout + ' VALIDATED (' + inputtime + ' vs ' + datastore.data.transaction.time + ')')
                                                                }
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
                                                if (valid === true && amountoutput !== amountinput) {
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
                                                valid = false
                                            }

                                            // ALL VALID, INSERTING TRANSACTION IN DB
                                            if (valid === true) {
                                                utils.log('ALL TRANSACTION\'S CHECKS PASSED, STORING.')
                                                datastore.data.block = datastore.block
                                                let insertTx = false
                                                let retries = 0
                                                global['valid_txs_block'].push(datastore)
                                                while (insertTx === false) {
                                                    try {
                                                        let checkTx = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                                        if (checkTx[0] === undefined) {
                                                            await db.collection("sc_transactions").insertOne(datastore.data, { w: 1, j: true })
                                                            let checkinsertedTx = await db.collection('sc_transactions').find({ sxid: datastore.data.sxid }).limit(1).toArray()
                                                            if (checkinsertedTx[0] !== undefined) {
                                                                insertTx = true
                                                            }
                                                            retries++
                                                            if (retries > 10) {
                                                                insertTx = true
                                                                client.close()
                                                                response(false)
                                                            }
                                                        } else {
                                                            insertTx = true
                                                        }
                                                    } catch (e) {
                                                        retries++
                                                        if (retries > 10) {
                                                            insertTx = true
                                                            client.close()
                                                            response(false)
                                                        }
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
                                                        let retries = 0
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
                                                                } else if (checkUnspentRedeemed[0] === undefined) {
                                                                    updated = true
                                                                    if (vout !== 'reissue' && vout !== 'genesis') {
                                                                        utils.log('UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + sxid + ':' + vout + ' DOESN\'T EXISTS!', '', 'errors')
                                                                    }
                                                                }

                                                                retries++
                                                                if (retries > 10) {
                                                                    updated = true
                                                                    client.close()
                                                                    response(false)
                                                                }
                                                            } catch (e) {
                                                                retries++
                                                                if (retries > 10) {
                                                                    updated = true
                                                                    client.close()
                                                                    response(false)
                                                                }
                                                                console.log(e)
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
                                                    let retries = 0
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
                                                            } else {
                                                                utils.log('WHY UNSPENT EXISTS YET?')
                                                                await db.collection('sc_unspent').deleteOne({ sxid: datastore.data.sxid, vout: vout }, { w: 1, j: true })
                                                                let checkInsertedUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                                if (checkInsertedUsxo[0] !== undefined) {
                                                                    insertedUsxo = true
                                                                }
                                                            }

                                                            retries++
                                                            if (retries > 10) {
                                                                insertedUsxo = true
                                                                client.close()
                                                                response(false)
                                                            }
                                                        } catch (e) {
                                                            retries++
                                                            if (retries > 10) {
                                                                insertedUsxo = true
                                                                client.close()
                                                                response(false)
                                                            }
                                                            utils.log('ERROR WHILE INSERTING UNSPENT, RETRY.', '', 'errors')
                                                            utils.log(e)
                                                        }
                                                    }
                                                    vout++
                                                }
                                                utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS VALID', '\x1b[32m%s\x1b[0m')
                                                // TRANSACTION STORED CORRECTLY
                                                response(true)
                                            } else {
                                                utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' + datastore.block + ' IS NOT VALID', '\x1b[31m%s\x1b[0m', 'errors')
                                                response('INVALID')
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
                                                        let retries = 0
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
                                                                } else if (checkUnspentRedeemed[0] === undefined) {
                                                                    updated = true
                                                                    if (vout !== 'reissue' && vout !== 'genesis') {
                                                                        utils.log('UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + sxid + ':' + vout + ' DOESN\'T EXISTS!', '', 'errors')
                                                                    }
                                                                }

                                                                retries++
                                                                if (retries > 10) {
                                                                    updated = true
                                                                    client.close()
                                                                    response(false)
                                                                }
                                                            } catch (e) {
                                                                retries++
                                                                if (retries > 10) {
                                                                    updated = true
                                                                    client.close()
                                                                    response(false)
                                                                }
                                                                console.log(e)
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
                                                    let retries = 0
                                                    while (inserted === false) {
                                                        try {
                                                            let checkUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                            if (checkUsxo[0] === undefined) {
                                                                utils.log('UPDATING UNSPENT ' + datastore.data.sxid + ':' + vout + ' FOR ADDRESS ' + x)
                                                                await db.collection('sc_unspent').insertOne(unspent, { w: 1, j: true })
                                                                let checkInsertedUsxo = await db.collection('sc_unspent').find({ sxid: datastore.data.sxid, vout: vout }).limit(1).toArray()
                                                                if (checkInsertedUsxo[0] !== undefined) {
                                                                    inserted = true
                                                                }
                                                            } else {
                                                                inserted = true
                                                            }

                                                            retries++
                                                            if (retries > 10) {
                                                                inserted = true
                                                                client.close()
                                                                response(false)
                                                            }
                                                        } catch (e) {
                                                            retries++
                                                            if (retries > 10) {
                                                                inserted = true
                                                                client.close()
                                                                response(false)
                                                            }
                                                            utils.log('ERROR WHILE INSERTING UNSPENT, RETRY.', '', 'errors')
                                                            utils.log(e)
                                                        }
                                                    }
                                                    vout++
                                                }
                                                client.close()
                                                response(true)
                                            }
                                        }
                                    } else {
                                        console.log('SIDECHAIN DOESN\'T EXIST!')
                                    }
                                }
                            }
                            client.close()
                            response('STORED')
                        }
                    })
                } catch (e) {
                    utils.log(e, '', 'errors')
                    response(false)
                }
            })
        }

        // RECEIVED DATA
        private async storereceived(datastore): Promise<any> {
            return new Promise(async response => {
                const utils = new Utilities.Parser
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        let check = await db.collection('received').find({ txid: datastore.txid, address: datastore.address }).limit(1).toArray()
                        if (check[0] === undefined) {
                            console.log('STORING DATA NOW!')
                            let inserted = false
                            let retries = 0
                            while (!inserted) {
                                try {
                                    await db.collection("received").insertOne(datastore, { w: 1, j: true })
                                    let checkInserted = await db.collection('received').find({ txid: datastore.txid, address: datastore.address }).limit(1).toArray()
                                    if (checkInserted[0] !== undefined) {
                                        inserted = true
                                    }

                                    retries++
                                    if (retries > 10) {
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                    utils.log('RECEIVED DATA ' + JSON.stringify(datastore))
                                } catch (e) {
                                    retries++
                                    if (retries > 10) {
                                        inserted = true
                                        client.close()
                                        response(false)
                                    }
                                    utils.log('DB ERROR WHILE STORING RECEIVED', '', 'errors')
                                    utils.log(e, '', 'errors')
                                    client.close()
                                    response(false)
                                }
                            }
                        } else {
                            utils.log('DATA ALREADY STORED.')
                            if (check[0].block === undefined || check[0].block === null) {
                                await db.collection("received").updateMany({ txid: datastore.txid }, { $set: { block: datastore.block } }, { writeConcern: { w: 1, j: true } })
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

        // CONSOLIDATE DATA
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
                                            }, { writeConcern: { w: 1, j: true } })
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
                        }
                        client.close()
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

        private consolidateplanum() {
            return new Promise(async response => {
                try {
                    mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                        var db = client.db(global['db_name'])
                        const utils = new Utilities.Parser
                        let checkplanumtxs = await db.collection('sc_transactions').find({ block: null, "transaction": { $exists: true } }).toArray()
                        if (checkplanumtxs.length > 0) {
                            utils.log('FOUND ' + checkplanumtxs.length + ' SIDECHAIN TRANSACTIONS TO CONSOLIDATE')
                            for (let k in checkplanumtxs) {
                                let tx = checkplanumtxs[k]
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
                                }

                                if (txvalid === true && block['height'] !== undefined && block['hash'] !== undefined && block['time'] !== undefined) {
                                    utils.log('SUCCESSFULLY CONSOLIDATED TRANSACTION ' + tx.address + ':' + tx.txid + '!')
                                    try {
                                        await db.collection("sc_transactions").updateOne({
                                            txid: tx.txid
                                        }, {
                                            $set: {
                                                block: block['height']
                                            }
                                        }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                        utils.log(e)
                                    }
                                    try {
                                        await db.collection("sc_unspent").updateMany({
                                            txid: tx.txid
                                        }, {
                                            $set: {
                                                block: block['height']
                                            }
                                        }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                        utils.log(e)
                                    }
                                }
                            }
                        } else {
                            utils.log('NOTHING TO CONSOLIDATE FROM PLANUM TRANSACTIONS')
                        }
                        let checkplanumunspent = await db.collection('sc_unspent').find({ block: null }).toArray()
                        if (checkplanumunspent.length > 0) {
                            utils.log('FOUND ' + checkplanumunspent.length + ' SIDECHAIN UNSPENT TO CONSOLIDATE')
                            for (let k in checkplanumunspent) {
                                let unspent = checkplanumunspent[k]
                                var wallet = new Crypto.Wallet
                                let rawtransaction = await wallet.request('getrawtransaction', [unspent.txid, 1])
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
                                }

                                if (txvalid === true && block['height'] !== undefined && block['hash'] !== undefined && block['time'] !== undefined) {
                                    utils.log('SUCCESSFULLY CONSOLIDATED TRANSACTION ' + unspent.address + ':' + unspent.txid + '!')
                                    try {
                                        await db.collection("sc_transactions").updateOne({
                                            txid: unspent.txid
                                        }, {
                                            $set: {
                                                block: block['height']
                                            }
                                        }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                        utils.log(e)
                                    }
                                    try {
                                        await db.collection("sc_unspent").updateMany({
                                            txid: unspent.txid
                                        }, {
                                            $set: {
                                                block: block['height']
                                            }
                                        }, { writeConcern: { w: 1, j: true } })
                                    } catch (e) {
                                        utils.log('ERROR ON DB WHILE CONSOLIDATING', '', 'errors')
                                        utils.log(e)
                                    }
                                }
                            }
                        } else {
                            utils.log('NOTHING TO CONSOLIDATE FROM PLANUM UNSPENT')
                        }
                        client.close()
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