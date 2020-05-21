"use strict";
import express = require("express")
import * as Crypto from './Crypto'
import * as Sidechain from './Sidechain'
import * as Utilities from './Utilities'
require('dotenv').config()
const mongo = require('mongodb').MongoClient
import { create, all } from 'mathjs'
import { utils } from "mocha";
const messages = require('./p2p/messages.js')
const console = require('better-console')

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
var analyzed = 0
const fs = require('fs')

module Daemon {

  export class Sync {
    
    public async init() {
        var wallet = new Crypto.Wallet
        // console.clear()
        wallet.request('getinfo').then(info => {
            blocks = info['result'].blocks
            console.log('FOUND ' + blocks + ' BLOCKS IN THE BLOCKCHAIN')
            var task = new Daemon.Sync
            task.process()
        })
    }

    public async process(){
        let utils = new Utilities.Parser
        try{
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
            var db = client.db(global['db_name'])
            global['isSyncing'] = true
            const sync = await db.collection('blocks').find().sort({ block: -1 }).limit(2).toArray()
            var last
            if(sync[0] === undefined){
                console.log('Sync lock not found, creating')
                await db.collection('blocks').insertOne({block: 0, time: new Date().getTime() });
                last = 0
            }else{
                last = sync[0].block
                let continuitycheck = last - 1
                if(continuitycheck !== sync[1].block){
                    last = continuitycheck - 1
                }
            }

            if(last !== null && last !== undefined){
                analyze = parseInt(last) + 1
            }else{
                analyze = 1
            }

            // ANALYZING MEMPOOL ONLY IF SYNC IS FINISHED
            var remains = blocks - analyze
            if(remains === -1){
                console.log('\x1b[31m%s\x1b[0m', 'ANALYZING MEMPOOL')
                var wallet = new Crypto.Wallet
                var mempool = await wallet.analyzeMempool()
                for(var address in mempool['data_written']){
                    var data = mempool['data_written'][address]
                    console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                    for(var dix in data){
                        var task = new Daemon.Sync
                        if(data[dix].protocol !== 'chain://'){
                            await task.storewritten(data[dix], true)
                        }else{
                            await task.storewritten(data[dix], true)
                            await task.storeplanum(data[dix], true)
                        }
                    }
                }

                for(var address in mempool['data_received']){
                    var data = mempool['data_received'][address]
                    console.log('\x1b[32m%s\x1b[0m', 'FOUND RECEIVED DATA FOR ' + address + '.')
                    for(var dix in data){
                        var task = new Daemon.Sync
                        await task.storereceived(data[dix])
                    }
                }

                for(var txid in mempool['analysis']){
                    for(var address in mempool['analysis'][txid]['balances']){
                        var tx = mempool['analysis'][txid]['balances'][address]
                        var movements = mempool['analysis'][txid]['movements']
                        var task = new Daemon.Sync
                        console.log('STORING '+ tx.type +' OF '+ tx.value + ' ' + process.env.COIN + ' FOR ADDRESS ' + address + ' FROM MEMPOOL')
                        await task.store(address, mempool, txid, tx, movements)
                    }
                }

                for(var i in mempool['outputs']){
                    let unspent = mempool['outputs'][i]
                    var found = false
                    for(var i in mempool['inputs']){
                        let input = mempool['inputs'][i]
                        if(input['txid'] === unspent['txid'] && input['vout'] === unspent['vout']){
                            found = true
                        }
                    }
                    if(found === false){
                        await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], null)
                    }else{
                        console.log('\x1b[35m%s\x1b[0m', 'IGNORING OUTPUTS BECAUSE IT\'S USED IN THE SAME BLOCK.')
                    }
                }

                for(var i in mempool['inputs']){
                    let input = mempool['inputs'][i]
                    await task.redeemunspent(input['txid'], input['vout'], null)
                }
            
            }

            client.close()

            if(analyze <= blocks){
                if(global['syncLock'] === false){
                    let utils = new Utilities.Parser
                    try{
                        var task = new Daemon.Sync
                        let synced = await task.analyze()
                        console.log('SUCCESSFULLY SYNCED BLOCK ' + synced)
                        if(synced !== false){
                            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                                var db = client.db(global['db_name'])
                                const savecheck = await db.collection('blocks').find({ block: synced }).toArray()
                                if(savecheck[0] === undefined){
                                    await db.collection('blocks').insertOne({block: synced, time: new Date().getTime()})
                                }
                                client.close()
                                setTimeout(function(){
                                    var task = new Daemon.Sync
                                    task.process()
                                },10)
                            })
                        }else{
                            setTimeout(function(){
                                var task = new Daemon.Sync
                                task.process()
                            },10)
                        }
                    }catch(e){
                        utils.log(e)
                        setTimeout(function(){
                            var task = new Daemon.Sync
                            task.process()
                        },10)
                    }
                }
            }else{
                global['isSyncing'] = false
                console.log('SYNC FINISHED')
            }
            })
        }catch(e){
            utils.log(e)
            setTimeout(function(){
                var task = new Daemon.Sync
                task.process()
            },10)
        }
    }

    public async analyze(toAnalyze = null){
        return new Promise(async response => {
            try{
                if(toAnalyze !== null){
                    analyze = toAnalyze
                }
                // ANALYZING BLOCK
                if(analyze > 0){
                    console.log('\x1b[32m%s\x1b[0m', 'ANALYZING BLOCK ' + analyze)
                    
                    var wallet = new Crypto.Wallet
                    var blockhash = await wallet.request('getblockhash',[analyze])
                    var block = await wallet.analyzeBlock(blockhash['result'])
                    
                    for(var txid in block['analysis']){
                        for(var address in block['analysis'][txid]['balances']){
                            var tx = block['analysis'][txid]['balances'][address]
                            var movements = block['analysis'][txid]['movements']
                            var task = new Daemon.Sync
                            console.log('STORING '+ tx.type +' OF '+ tx.value + ' ' + process.env.COIN + ' FOR ADDRESS ' + address)
                            let storedtx = await task.store(address, block, txid, tx, movements)
                            if(storedtx === false){
                                response(false)
                            }
                        }
                    }

                    for(var i in block['outputs']){
                        let unspent = block['outputs'][i]
                        var found = false
                        for(var i in block['inputs']){
                            let input = block['inputs'][i]
                            if(input['txid'] === unspent['txid'] && input['vout'] === unspent['vout']){
                                found = true
                            }
                        }
                        if(found === false){
                            let storedunspent = await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], analyze)
                            if(storedunspent === false){
                                response(false)
                            }
                        }else{
                            console.log('\x1b[35m%s\x1b[0m', 'IGNORING OUTPUTS BECAUSE IT\'S USED IN THE SAME BLOCK.')
                        }
                    }

                    for(var i in block['inputs']){
                        let input = block['inputs'][i]
                        let redeemedunspent = await task.redeemunspent(input['txid'], input['vout'], analyze)
                        if(redeemedunspent === false){
                            response(false)
                        }
                    }
                    // console.log('CLEANING UTXO CACHE')
                    global['utxocache'] = []
                    global['txidcache'] = []
                    // console.log('CLEANING USXO CACHE')
                    global['usxocache'] = []
                    global['sxidcache'] = []

                    for(var address in block['data_written']){
                        var data = block['data_written'][address]
                        console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                        for(var dix in data){
                            if(data[dix].protocol !== 'chain://'){
                                var task = new Daemon.Sync
                                let storedwritten = await task.storewritten(data[dix], false, block['height'])
                                if(storedwritten === false){
                                    response(false)
                                }
                            }
                        }
                    }

                    for(var dix in block['planum']){
                        console.log('\x1b[32m%s\x1b[0m', 'FOUND PLANUM TX.')
                        var task = new Daemon.Sync
                        let storedwritten = await task.storewritten(block['planum'][dix], false, block['height'])
                        if(storedwritten === false){
                            response(false)
                        }
                        let storedplanum = await task.storeplanum(block['planum'][dix], false, block['height'])
                        if(storedplanum === false){
                            response(false)
                        }
                    }

                    for(var address in block['data_received']){
                        var data = block['data_received'][address]
                        console.log('\x1b[32m%s\x1b[0m', 'FOUND RECEIVED DATA FOR ' + address + '.')
                        for(var dix in data){
                            var task = new Daemon.Sync
                            let storedreceived = await task.storereceived(data[dix])
                            if(storedreceived === false){
                                response(false)
                            }
                        }
                    }

                    var remains = blocks - analyze
                    console.log('\x1b[33m%s\x1b[0m', remains + ' BLOCKS UNTIL END.')

                    response(block['height'])
                }else{
                    response(false)
                }
            }catch(e){
                response(false)
            }
        })

    }

    private async store(address, block, txid, tx, movements){
        return new Promise (async response => {
            let utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    let check = await db.collection('transactions').find({address: address, txid: txid}).limit(1).toArray();
                    if(check[0] === undefined){
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
                                    time: block['time']
                                }
                            )
                    }else if(check[0].blockheight === null && block['height'] !== undefined){
                        await db.collection("transactions").updateOne({
                                address: address, txid: txid
                            },{ 
                                $set: {
                                    blockheight: block['height'],
                                    blockhash: block['hash'],
                                    time: block['time']
                                }
                            })
                    }else{
                        console.log('TX ALREADY STORED.')
                    }
                    client.close()
                    response(block['height'])
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }

    private async storeunspent(address, vout, txid, amount, scriptPubKey, block){
        return new Promise (async response => {
            let utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    let check = await db.collection("unspent").find({txid: txid, vout: vout}).limit(1).toArray()
                    if(check[0] === undefined){
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
                            }
                        )
                    }else if(check[0].block === null && block !== null){
                        console.log('\x1b[36m%s\x1b[0m', 'UPDATING BLOCK NOW!')
                        await db.collection("unspent").updateOne({txid: txid, vout: vout}, {$set: {block: block}})
                    }else{
                        console.log('UNSPENT ALREADY STORED.')
                    }
                    client.close()
                    response(true)
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }

    private async redeemunspent(txid, vout, block){
        return new Promise (async response => {
            let utils = new Utilities.Parser
            try{
                console.log('\x1b[31m%s\x1b[0m', 'REDEEMING UNSPENT NOW!')
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    await db.collection('unspent').updateOne({txid: txid, vout: vout}, {$set: {redeemblock: block, redeemed: txid}})
                    client.close()
                    response(true)
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }

    private async storewritten(datastore, isMempool = false, block = null){
        return new Promise (async response => {
            const utils = new Utilities.Parser
            try{
                datastore.block = block
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    let check = await db.collection('written').find({uuid: datastore.uuid, block: datastore.block}).limit(1).toArray()
                    if(check[0] === undefined){
                        console.log('STORING DATA NOW!')
                        if(JSON.stringify(datastore.data).indexOf('ipfs:') !== -1){
                            let parsed = datastore.data.split('***')
                            if(parsed[0] !== undefined){
                                let parsehash = parsed[0].split(':')
                                if(parsehash[1] !== undefined && parsehash[1] !== 'undefined'){
                                    console.log('\x1b[42m%s\x1b[0m', 'PINNING IPFS HASH ' + parsehash[1])
                                    global['ipfs'].pin.add(parsehash[1], function (err) {
                                        if (err) {
                                            throw err
                                        }
                                    })
                                }
                            }
                        }
                        if(datastore.uuid !== undefined && datastore.uuid !== ''){
                            await db.collection("written").insertOne(datastore)
                        }
                    }else{
                        if(datastore.block !== null){
                            console.log('DATA ALREADY STORED AT BLOCK '+ datastore.block +'.')
                        }else{
                            console.log('DATA ALREADY STORED FROM MEMPOOL.')
                        }
                    }

                    client.close()
                    response('STORED')
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }

    private async storeplanum(datastore, isMempool = false, block = null){
        return new Promise (async response => {
            const utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    datastore.block = block
                    if(datastore.protocol === 'chain://'){
                        // SEARCHING FOR GENESIS
                        if(datastore.data.genesis !== undefined){
                            let check = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                            if(check[0] === undefined){
                                console.log('STORING GENESIS SXID NOW!')
                                await db.collection("sc_transactions").insertOne(datastore.data)
                            }else{
                                console.log('GENESIS SXID ALREADY STORED.')
                                if(datastore.block === null){
                                    await db.collection("sc_transactions").updateOne({sxid: datastore.data.sxid}, {$set: {block: datastore.block}})
                                }
                            }
                        }

                        // SEARCHING FOR REISSUE
                        if(datastore.data.reissue !== undefined){
                            let check = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                            if(check[0] === undefined){
                                console.log('STORING REISSUE SXID NOW!')
                                await db.collection("sc_transactions").insertOne(datastore.data)
                            }else{
                                console.log('REISSUE SXID ALREADY STORED.')
                                if(datastore.block === null){
                                    await db.collection("sc_transactions").updateOne({sxid: datastore.data.sxid}, {$set: {block: datastore.block}})
                                }
                            }
                        }

                        //SEARCHING FOR TRANSACTION
                        if(datastore.data.transaction !== undefined){
                            var scwallet = new Sidechain.Wallet;
                            console.log('PLANUM TRANSACTION FOUND.')
                            let check = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                            let check_sidechain = await db.collection('written').find({ address: datastore.data.transaction.sidechain, "data.genesis": {$exists: true} }).sort({ block: 1 }).limit(1).toArray()
                            if(check_sidechain[0] !== undefined){
                                if(check[0] === undefined){
                                    // TRANSACTION NEVER STORED
                                    let valid = true
                                    var amountinput = 0
                                    var amountoutput = 0
                                    var isGenesis = false

                                    if(datastore.data.transaction.inputs.length > 0){
                                        for(let x in datastore.data.transaction.inputs){
                                            let sxid = datastore.data.transaction.inputs[x].sxid
                                            let vout = datastore.data.transaction.inputs[x].vout
                                            let validategenesis = await scwallet.validategenesis(sxid, datastore.data.transaction.sidechain)
                                            if(validategenesis === false){
                                                let validateinput = await scwallet.validateinput(sxid, vout, datastore.data.transaction.sidechain, datastore.address)
                                                if(validateinput === false){
                                                    valid = false
                                                    utils.log('INPUT ' + sxid + ':'+ vout +' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' +datastore.block + ' IS INVALID.')
                                                }else if(validateinput === true){
                                                    let isDoubleSpended = await scwallet.checkdoublespending(sxid, vout, datastore.data.transaction.sidechain, datastore.data.sxid)
                                                    if(isDoubleSpended === true){
                                                        valid = false
                                                        utils.log('INPUT ' + sxid + ':'+ vout +' IN SIDECHAIN ' + datastore.data.transaction.sidechain + ' AT BLOCK ' +datastore.block + ' IS A DOUBLE SPEND.')
                                                    }
                                                }
                                            }
                                            // CHECKING GENESIS
                                            if(datastore.data.transaction.inputs[x].vout === 'genesis' || datastore.data.transaction.inputs[x].vout === 'reissue'){
                                                isGenesis = true
                                            }
                                            if(check_sidechain[0].data.genesis !== undefined){
                                                if(valid === true && datastore.data.transaction.inputs[x].amount !== undefined){
                                                    let fixed = math.round(datastore.data.transaction.inputs[x].amount,check_sidechain[0].data.genesis.decimals)
                                                    amountinput = math.sum(amountinput, fixed)
                                                }
                                            }else{
                                                valid = false
                                                console.log('SIDECHAIN DOES NOT EXIST.')
                                            }
                                        }
                                    }else{
                                        valid = false
                                    }

                                    if(check_sidechain[0].data.genesis !== undefined){
                                        if(valid === true){
                                            for(let x in datastore.data.transaction.outputs){
                                                let fixed = math.round(datastore.data.transaction.outputs[x], check_sidechain[0].data.genesis.decimals)
                                                amountoutput = math.sum(amountoutput, fixed)
                                            }
                                        }
                                        amountoutput = math.round(amountoutput, check_sidechain[0].data.genesis.decimals)
                                        amountinput = math.round(amountinput, check_sidechain[0].data.genesis.decimals)
                                    }else{
                                        valid = false
                                    }

                                    if(!isGenesis){
                                        if(valid === true && amountoutput > amountinput){
                                            valid = false
                                            utils.log('AMOUNT IS INVALID IN SIDECHAIN TRANSACTION ' + datastore.data.transaction.sidechain + ' ' + datastore.data.sxid +' AT BLOCK ' +datastore.block + ' > OUT:' + amountoutput +  ' IN: ' + amountinput)
                                        }
                                    }

                                    // CHECK SIGNATURE
                                    var wallet = new Crypto.Wallet;
                                    if(valid === true && datastore.data.pubkey !== undefined && datastore.data.signature !== undefined && datastore.data.transaction !== undefined){
                                        let validatesign = await wallet.verifymessage(datastore.data.pubkey,datastore.data.signature,JSON.stringify(datastore.data.transaction))
                                        if(validatesign === false){
                                            valid = false
                                        }
                                    }else{
                                        valid = false
                                    }
                                    
                                    if(valid === true){
                                        datastore.data.block = datastore.block
                                        let checkTx = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                                        if(checkTx[0] === undefined){
                                            await db.collection("sc_transactions").insertOne(datastore.data)
                                        }

                                        // REEDIMING UNSPENT FOR EACH INPUT
                                        for(let x in datastore.data.transaction.inputs){
                                            let sxid = datastore.data.transaction.inputs[x].sxid
                                            let vout = datastore.data.transaction.inputs[x].vout
                                            if (global['sxidcache'].indexOf(sxid + ':' + vout) === -1 && isMempool) {
                                                global['sxidcache'].push(sxid + ':' + vout)
                                                await messages.signandbroadcast('planum-unspent', sxid + ':' + vout)
                                            }
                                            if(datastore.block !== null){
                                                await db.collection('sc_unspent').updateOne({sxid: sxid, vout: vout}, {$set: {redeemed: datastore.data.sxid, redeemblock: datastore.block}})
                                            }else{
                                                await db.collection('sc_unspent').updateOne({sxid: sxid, vout: vout}, {$set: {redeemed: datastore.data.sxid}})
                                            }
                                            utils.log('REDEEMING UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + sxid + ':' + vout + ' AT BLOCK ' +datastore.block)
                                        }

                                        // CREATING UNSPENT FOR EACH VOUT
                                        let vout = 0
                                        for(let x in datastore.data.transaction.outputs){
                                            let amount = datastore.data.transaction.outputs[x]
                                            let unspent = {
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
                                            let checkUsxo = await db.collection('sc_unspent').find({sxid: datastore.data.sxid, vout: vout}).limit(1).toArray()
                                            if(checkUsxo[0] === undefined){
                                                await db.collection("sc_unspent").insertOne(unspent)
                                            }
                                            vout++
                                        }
                                        utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN '+datastore.data.transaction.sidechain+' AT BLOCK ' +datastore.block + ' IS VALID')
                                        // TRANSACTION STORED CORRECTLY
                                    }else{
                                        utils.log('TRANSACTION ' + datastore.data.sxid + ' IN SIDECHAIN '+datastore.data.transaction.sidechain+' AT BLOCK ' +datastore.block + ' IS INVALID')
                                    }
                                }else{
                                    // VALIDATING DATA ALREADY STORED FROM MEMPOOL
                                    let doublespending = false
                                    if(!isMempool){ // IGNORING IF WE'RE STILL WORKING WITH MEMPOOL
                                        if(datastore.block !== null){ // BE SURE THAT STORED IS NOT VALIDATED
                                            console.log('SIDECHAIN TRANSACTION ALREADY STORED FROM MEMPOOL, VALIDATING.')
                                            for(let x in datastore.data.transaction.inputs){
                                                let sxid = datastore.data.transaction.inputs[x].sxid
                                                let vout = datastore.data.transaction.inputs[x].vout
                                                // CHECKING FOR DOUBLE SPENDING
                                                let isDoubleSpended = await scwallet.checkdoublespending(sxid, vout, datastore.data.transaction.sidechain, datastore.data.sxid)
                                                if(isDoubleSpended === true){
                                                    utils.log('INPUT ' + sxid + ':' + vout + ' AT BLOCK ' +datastore.block + ' IS DOUBLE SPENDED')
                                                    doublespending = true
                                                    // DOUBLE SPENDING FOUND, DELETING ALL UNSPENTS AND TRANSACTION
                                                    await db.collection('sc_unspent').deleteMany({sxid: datastore.data.sxid})
                                                    await db.collection('sc_transactions').deleteOne({sxid: datastore.data.sxid})
                                                }
                                            }

                                            if(!doublespending){
                                                // UPDATING BLOCK
                                                for(let x in datastore.data.transaction.inputs){
                                                    let sxid = datastore.data.transaction.inputs[x].sxid
                                                    let vout = datastore.data.transaction.inputs[x].vout
                                                    await db.collection('sc_unspent').updateOne({sxid: sxid, vout: vout}, {$set: {redeemed: datastore.data.sxid, redeemblock: datastore.block}})
                                                    utils.log('REDEEMING UNSPENT IN SIDECHAIN ' + datastore.data.transaction.sidechain +' ' + sxid + ':' + vout)
                                                }
                                                
                                                await db.collection("sc_transactions").updateOne({sxid: datastore.data.sxid}, {$set: {block: datastore.block}})
                                                utils.log('TRANSACTION IN SIDECHAIN ' + datastore.data.transaction.sidechain + ':' + datastore.data.sxid + ' AT BLOCK ' +datastore.block + ' IS VALID')

                                                let vout = 0
                                                for(let x in datastore.data.transaction.outputs){
                                                    await db.collection('sc_unspent').updateOne({sxid: datastore.data.sxid, vout: vout}, {$set: {block: datastore.block}})
                                                    vout++
                                                }
                                            }
                                        }
                                    }
                                }
                            }else{
                                console.log('SIDECHAIN DOESN\'T EXIST!')
                            }
                        }
                    }
                    client.close()
                    response('STORED')
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }

    private async storereceived(datastore){
        return new Promise (async response => {
            const utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    var db = client.db(global['db_name'])
                    let check = await db.collection('received').find({txid: datastore.txid, address: datastore.address}).limit(1).toArray()
                    if(check[0] === undefined){
                        console.log('STORING DATA NOW!')
                        await db.collection("received").insertOne(datastore)
                    }else{
                        console.log('DATA ALREADY STORED.')
                        if(check[0].block === undefined || check[0].block === null){
                            await db.collection("sc_transactions").updateOne({txid: datastore.txid}, {$set: {block: datastore.block}})
                        }
                    }
                    client.close()
                    response('STORED')
                })
            }catch(e){
                utils.log(e)
                response(false)
            }
        })
    }
  }

}

export = Daemon;
