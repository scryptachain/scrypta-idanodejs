"use strict";
import express = require("express")
import * as Crypto from './Crypto'
import * as Sidechain from './Sidechain'
require('dotenv').config()
const mongo = require('mongodb').MongoClient
import { create, all } from 'mathjs'

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
        wallet.request('getinfo').then(info => {
            blocks = info['result'].blocks
            console.log('FOUND ' + blocks + ' BLOCKS IN THE BLOCKCHAIN')
            var task = new Daemon.Sync
            task.process()
        })
    }

    public async process(){
        mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
            var db = client.db(global['db_name'])
            global['isSyncing'] = true
            var reset = '' //CHECK FOR RESET VALUE
            const sync = await db.collection('settings').find({setting:'sync'}).limit(1).toArray();
            var last
            if(sync[0] === undefined){
                console.log('Sync lock not found, creating')
                await db.collection('settings').insertOne({setting:'sync', value: 0});
                last = 0
            }else{
                last = sync[0].value
            }
            if(reset !== undefined && reset === ''){
                if(last !== null && last !== undefined){
                    analyze = parseInt(last) + 1
                }else{
                    analyze = 1
                }
            }else{
                analyze = 1
            }

            // ANALYZING MEMPOOL
            console.log('\x1b[32m%s\x1b[0m', 'ANALYZING MEMPOOL')
            var wallet = new Crypto.Wallet
            var mempool = await wallet.analyzeMempool()
            for(var address in mempool['data_written']){
                var data = mempool['data_written'][address]
                console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                for(var dix in data){
                    var task = new Daemon.Sync
                    await task.storewritten(data[dix], true)
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
            
            client.close()

            if(analyze <= blocks){
                if(global['syncLock'] === false){
                    var task = new Daemon.Sync
                    task.analyze()
                }
            }else{
                global['isSyncing'] = false
                console.log('SYNC FINISHED')
            }
        })
    }

    public async analyze(toAnalyze = null){
        if(toAnalyze !== null){
            analyze = toAnalyze
        }
        
        // ANLYZING BLOCK
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
                    await task.store(address, block, txid, tx, movements)
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
                    await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], analyze)
                }else{
                    console.log('\x1b[35m%s\x1b[0m', 'IGNORING OUTPUTS BECAUSE IT\'S USED IN THE SAME BLOCK.')
                }
            }

            for(var i in block['inputs']){
                let input = block['inputs'][i]
                await task.redeemunspent(input['txid'], input['vout'], analyze)
            }
            console.log('CLEANING UTXO CACHE')
            global['utxocache'] = []
            global['txidcache'] = []
            console.log('CLEANING USXO CACHE')
            global['usxocache'] = []
            global['sxidcache'] = []

            for(var address in block['data_written']){
                var data = block['data_written'][address]
                console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                for(var dix in data){
                    if(data[dix].protocol !== 'chain://'){
                        var task = new Daemon.Sync
                        await task.storewritten(data[dix], false)
                    }else{
                        console.log('IS PLANUM, IGNORING')
                    }
                }
            }

            for(var address in block['planum']){
                var data = block['planum'][address]
                console.log('\x1b[32m%s\x1b[0m', 'FOUND PLANUM TX FOR ' + address + '.')
                for(var dix in data){
                    var task = new Daemon.Sync
                    await task.storewritten(data[dix], false)
                }
            }

            for(var address in block['data_received']){
                var data = block['data_received'][address]
                console.log('\x1b[32m%s\x1b[0m', 'FOUND RECEIVED DATA FOR ' + address + '.')
                for(var dix in data){
                    var task = new Daemon.Sync
                    await task.storereceived(data[dix])
                }
            }

            var remains = blocks - analyze
            console.log('\x1b[33m%s\x1b[0m', remains + ' BLOCKS UNTIL END.')
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                var db = client.db(global['db_name'])
                await db.collection('settings').updateOne({setting: "sync"}, {$set: {value: block['height']}})
                client.close()
                setTimeout(function(){
                    var task = new Daemon.Sync
                    task.process()
                },10)
            })
        }

    }

    private async store(address, block, txid, tx, movements){
        return new Promise (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                var db = client.db(global['db_name'])
                let check = await db.collection('transactions').find({address: address, txid: txid}).limit(1).toArray();
                if(check[0] === undefined){
                        console.log('STORING TX NOW!')
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
        })
    }

    private async storeunspent(address, vout, txid, amount, scriptPubKey, block){
        return new Promise (async response => {
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
        })
    }

    private async redeemunspent(txid, vout, block){
        return new Promise (async response => {
            console.log('\x1b[31m%s\x1b[0m', 'REDEEMING UNSPENT NOW!')
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                var db = client.db(global['db_name'])
                await db.collection('unspent').updateOne({txid: txid, vout: vout}, {$set: {redeemblock: block, redeemed: txid}})
                client.close()
                response(true)
            })
        })
    }

    private async storewritten(datastore, isMempool = false){
        return new Promise (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                var db = client.db(global['db_name'])
                let check = await db.collection('written').find({uuid: datastore.uuid, block: datastore.block}).limit(1).toArray()
                if(check[0] === undefined){
                    console.log('STORING DATA NOW!', datastore.data)
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
                    if(datastore.block !== undefined){
                        console.log('DATA ALREADY STORED AT BLOCK '+ datastore.block +'.')
                    }else{
                        console.log('DATA ALREADY STORED FROM MEMPOOL.')
                    }
                }

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
                        console.log('SC TRANSACTION FOUND.', JSON.stringify(datastore.data))
                        let check = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                        let check_sidechain = await db.collection('written').find({ address: datastore.data.transaction.sidechain, "data.genesis": {$exists: true} }).sort({ block: 1 }).limit(1).toArray()
                        if(check_sidechain[0] !== undefined){
                            if(check[0] === undefined){
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
                                                console.log('INPUT IS INVALID.')
                                            }
                                        }
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
                                            console.log(JSON.stringify(check_sidechain[0]))
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
                                }else{
                                    valid = false
                                    console.log(JSON.stringify(check_sidechain[0]))
                                }
                                if(check_sidechain[0].data.genesis !== undefined){
                                    amountoutput = math.round(amountoutput, check_sidechain[0].data.genesis.decimals)
                                    amountinput = math.round(amountinput, check_sidechain[0].data.genesis.decimals)
                                }else{
                                    valid = false
                                    console.log(JSON.stringify(check_sidechain[0]))
                                }
                                if(!isGenesis){
                                    if(valid === true && amountoutput > amountinput){
                                        valid = false
                                        console.log('AMOUNT IS INVALID', amountoutput, amountinput)
                                    }
                                }

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
                                    }else{
                                        console.log('SXID STORED YET')
                                    }

                                    for(let x in datastore.data.transaction.inputs){
                                        let sxid = datastore.data.transaction.inputs[x].sxid
                                        let vout = datastore.data.transaction.inputs[x].vout
                                        await db.collection('sc_unspent').updateOne({sxid: sxid, vout: vout}, {$set: {redeemed: datastore.data.sxid, redeemblock: datastore.block}})
                                        console.log('REDEEMING UNSPENT SIDECHAIN ' + sxid + ':' + vout)
                                    }
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
                                            redeemblock: null
                                        }
                                        let checkUsxo = await db.collection('sc_unspent').find({sxid: datastore.data.sxid, vout: vout}).limit(1).toArray()
                                        if(checkUsxo[0] === undefined){
                                            await db.collection("sc_unspent").insertOne(unspent)
                                        }
                                        vout++
                                    }
                                    console.log('SIDECHAIN TRANSACTION IS VALID')
                                }else{
                                    console.log('SIDECHAIN TRANSACTION IS INVALID')
                                }
                            }else{
                                console.log('SIDECHAIN UNSPENT ALREADY STORED.')
                                let checkTx = await db.collection('sc_transactions').find({sxid: datastore.data.sxid}).limit(1).toArray()
                                let doublespending = false
                                if(checkTx[0].block === null){
                                    await db.collection("sc_transactions").updateOne({sxid: datastore.data.sxid}, {$set: {block: datastore.block}})
                                }

                                for(let x in datastore.data.transaction.inputs){
                                    let sxid = datastore.data.transaction.inputs[x].sxid
                                    let vout = datastore.data.transaction.inputs[x].vout
                                    await db.collection('sc_unspent').updateOne({sxid: sxid, vout: vout}, {$set: {redeemed: datastore.data.sxid, redeemblock: datastore.block}})
                                    console.log('REDEEMING UNSPENT SIDECHAIN ' + sxid + ':' + vout)
                                    if(!isMempool){
                                        let checkdoublespended = await scwallet.checkdoublespending(sxid, vout, datastore.data.transaction.sidechain, checkTx)
                                        if(checkdoublespended === true){
                                            console.log('INPUT IS DOUBLE SPENDED')
                                            doublespending = true
                                            await db.collection('sc_transactions').deleteOne({sxid: datastore.data.sxid})
                                        }
                                    }
                                }

                                let vout = 0
                                for(let x in datastore.data.transaction.outputs){
                                    if(!doublespending){
                                        let checkUsxo = await db.collection('sc_unspent').find({sxid: datastore.data.sxid, vout: vout}).limit(1).toArray()
                                        if(checkUsxo[0] !== undefined){
                                            if(checkUsxo[0].block === undefined || checkUsxo[0].block === null){
                                                await db.collection('sc_unspent').updateOne({sxid: datastore.data.sxid, vout: vout}, {$set: {block: datastore.block}})
                                            }
                                        }
                                    }else{
                                        // await db.collection('sc_unspent').deleteOne({sxid: datastore.data.sxid, vout: vout})
                                    }
                                    vout++
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
        })
    }

    private async storereceived(datastore){
        return new Promise (async response => {
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
        })
    }
  }

}

export = Daemon;
