"use strict";
import express = require("express")
import * as Crypto from './Crypto'
require('dotenv').config()
const r = require('rethinkdb')

var blocks = 0
var analyze = 0
var conn
var analyzed = 0
const fs = require('fs')

module Daemon {

  export class Sync {
    
    public async init() {
        conn = await r.connect({ host: process.env.DB_HOST, port: process.env.DB_PORT, db: 'idanodejs'})
        var wallet = new Crypto.Wallet
        wallet.request('getinfo').then(info => {
            blocks = info['result'].blocks
            console.log('FOUND ' + blocks + ' BLOCKS IN THE BLOCKCHAIN')
            var task = new Daemon.Sync
            task.process()
        })
    }

    public async process(){
        var reset = '' //CHECK FOR RESET VALUE
        r.table("settings").filter({setting: "sync"}).run(conn, async function(err, cursor) {
            if(err) {
                console.log(err)
            }
            cursor.toArray(async function(err, result) {
                if(err) {
                    console.log(err)
                }
                var last
                if(result[0] === undefined){
                    console.log('Sync lock not found, creating')
                    await r.table("settings").insert({setting: "sync", value: 0}).run(conn)
                    last = 0
                }else{
                    last = result[0].value
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
                if(analyze <= blocks){
                    var task = new Daemon.Sync
                    task.analyze()
                }else{
                    console.log('SYNC FINISHED, RESTART IN 30 SECONDS')
                    setTimeout(function(){
                        var task = new Daemon.Sync
                        task.init()
                    },30000)
                }
            })
        })
    }

    public async analyze(){
        if(analyze > 0){
            var start = Date.now()
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
                await task.storeunspent(unspent['address'], unspent['vout'], unspent['txid'], unspent['amount'], unspent['scriptPubKey'], analyze)
            }

            for(var i in block['inputs']){
                let input = block['inputs'][i]
                await task.redeemunspent(input['txid'], input['vout'])
            }

            for(var address in block['data_written']){
                var data = block['data_written'][address]
                console.log('\x1b[32m%s\x1b[0m', 'FOUND WRITTEN DATA FOR ' + address + '.')
                for(var dix in data){
                    var task = new Daemon.Sync
                    await task.storewritten(data[dix])
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

            var end = Date.now()
            var elapsed = (end - start) / 1000
            var remains = blocks - analyze
            var estimated = (elapsed * remains) / 60 / 60;
            console.log('\x1b[33m%s\x1b[0m', 'FINISHED IN '+ elapsed +'s. ' + remains + ' BLOCKS UNTIL END. ' + estimated.toFixed(2) + 'h ESTIMATED.')
            r.table("settings").filter({setting: "sync"}).update({value: block['height']}).run(conn, result =>{
                setTimeout(function(){
                    var task = new Daemon.Sync
                    task.process()
                },10)
            })
        }else{
            console.log('\x1b[41m%s\x1b[0m', 'ANALYZED EVERYTHING REBOOTING PROCESS IN 30 SECONDS')
            setTimeout(function(){
                var task = new Daemon.Sync
                task.init()
            },30000)
        }
    }

    private async store(address, block, txid, tx, movements){
        return new Promise (async response => {
            r.table("transactions").getAll([address,txid], {index: "addresstxid"}).run(conn, async function(err, cursor) {
                if(err) {
                  console.log(err)
                }
                cursor.toArray(async function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    if(result[0] === undefined){
                        console.log('STORING TX NOW!')
                        await r.table("transactions").insert(
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
                        ).run(conn)
                    }else{
                        console.log('TX ALREADY STORED.')
                    }
                    response(block['height'])
                })
            })
        })
    }

    private async storeunspent(address, vout, txid, amount, scriptPubKey, block){
        return new Promise (async response => {
            r.table("unspent").getAll([txid,vout], {index: "txidvout"}).run(conn, async function(err, cursor) {
                if(err) {
                  console.log(err)
                }
                cursor.toArray(async function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    if(result[0] === undefined){
                        console.log('\x1b[36m%s\x1b[0m', 'STORING UNSPENT NOW!')
                        await r.table("unspent").insert(
                            {
                                address: address,
                                txid: txid,
                                scriptPubKey: scriptPubKey,
                                amount: amount,
                                vout: vout,
                                block: block
                            }
                        ).run(conn)
                    }else{
                        console.log('UNSPENT ALREADY STORED.')
                    }
                    response(true)
                })
            }).catch(error => {
                console.log(error)
            })
        })
    }

    private async redeemunspent(txid, vout){
        return new Promise (async response => {
            r.table("unspent").getAll([txid,vout], {index: "txidvout"}).run(conn, async function(err, cursor) {
                if(err) {
                  console.log(err)
                }
                cursor.toArray(async function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    if(result[0] !== undefined){
                        console.log('\x1b[31m%s\x1b[0m', 'REDEEMING UNSPENT NOW!')
                        await r.table("unspent").get(result[0]['id']).delete().run(conn)
                    }
                    response(true)
                })
            }).catch(error => {
                console.log(error)
            })
        })
    }

    private async storewritten(datastore){
        return new Promise (async response => {
            r.table("written").getAll([datastore.uuid,datastore.block], {index: "uuidblock"}).run(conn, async function(err, cursor) {
                if(err) {
                console.log(err)
                }
                cursor.toArray(async function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    if(result[0] === undefined){
                        console.log('STORING DATA NOW!')
                        await r.table("written").insert(datastore).run(conn)
                    }else{
                        console.log('DATA ALREADY STORED.')
                    }
                    response('STORED')
                })
            })
        })
    }

    private async storereceived(datastore){
        return new Promise (async response => {
            r.table("received").getAll([datastore.txid,datastore.address], {index: "txidaddress"}).run(conn, async function(err, cursor) {
                if(err) {
                console.log(err)
                }
                cursor.toArray(async function(err, result) {
                    if(err) {
                        console.log(err)
                    }
                    if(result[0] === undefined){
                        console.log('STORING DATA NOW!')
                        await r.table("received").insert(datastore).run(conn)
                    }else{
                        console.log('DATA ALREADY STORED.')
                    }
                    response('STORED')
                })
            })
        })
    }
  }

}

export = Daemon;
