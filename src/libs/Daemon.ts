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
        conn = await r.connect({db: 'idanodejs'})
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
        fs.readFile('sync.lock', {encoding: 'utf-8'}, async function(err,data){
            var last
            if(err){
                fs.writeFile("sync.lock",0, function(){
                    last = 0
                })
            }else{
                last = data
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
            var end = Date.now()
            var elapsed = (end - start) / 1000
            var remains = blocks - analyze
            var estimated = (elapsed * remains) / 60 / 60;
            console.log('\x1b[33m%s\x1b[0m', 'FINISHED IN '+ elapsed +'s. ' + remains + ' BLOCKS UNTIL END. ' + estimated.toFixed(2) + 'h ESTIMATED.')
            console.log('STORING UPDATED INDEX')
            fs.writeFile("sync.lock",block['height'], function(){
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
            var check
            await r.table("transactions").getAll([address,txid], {index: "addresstxid"}).run(conn, check)
            if(check === undefined){
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
            }
            response(block['height'])
        })
    }
  }

}

export = Daemon;