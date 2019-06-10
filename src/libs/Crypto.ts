"use strict";
import * as Utilities from './Utilities'
let request = require("request")

module Crypto {

  export class Wallet {

    public async request(method, params = []) {
        return new Promise(response => {
            var rpcuser = process.env.RPCUSER
            var rpcpassword = process.env.RPCPASSWORD
            var rpcendpoint = 'http://'+ process.env.RPCADDRESS +':' + process.env.RPCPORT
            if(process.env.DEBUG === "full"){
                console.log('Connecting to ' + rpcendpoint + ' WITH ' +rpcuser+'/'+rpcpassword)
            }
            let req = {
                url: rpcendpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(rpcuser + ":" + rpcpassword).toString("base64")
                },
                body: JSON.stringify({
                    id: Math.floor((Math.random() * 100000) + 1),
                    params: params,
                    method: method
                })
            };
            request(req, function (err, res, body) {
                try {
                    if(process.env.DEBUG === "full"){
                        console.log(body)
                    }
                    response(JSON.parse(body))
                } catch (err) {
                    response(body)
                }
            });
        })
    }

    public async analyzeTransaction(transaction){
        return new Promise (response => {
            response('TODO')
        })
    }

    public async analyzeBlock (block) {
        return new Promise (response => {
            var wallet = new Crypto.Wallet
            wallet.request('getblock', [block]).then(function(block){
                
                block['result']['totvin'] = 0
                block['result']['totvout'] = 0
                block['result']['fees'] = 0
                block['result']['analysis'] = {}
                block['result']['data'] = {}
                //PARSING ALL TRANSACTIONS
                new Promise (async resolve => {
                    for(var i = 0; i < block['result']['tx'].length; i++){
                        var txid = block['result']['tx'][i]
                        
                        var rawtx = await wallet.request('getrawtransaction', [txid])
                        var tx = await wallet.request('decoderawtransaction', [rawtx['result']])
                        block['result']['tx'][i] = tx['result']
                        
                        var txtotvin = 0
                        var txtotvout = 0
                        block['result']['analysis'][txid] = {}
                        block['result']['analysis'][txid]['vin'] = 0
                        block['result']['analysis'][txid]['vout'] = 0
                        block['result']['analysis'][txid]['balances'] = {}
                        
                        //FETCHING ALL VIN
                        for(var vinx = 0; vinx < block['result']['tx'][i]['vin'].length; vinx++){
                            var vout =  block['result']['tx'][i]['vin'][vinx]['vout']
                            if(block['result']['tx'][i]['vin'][vinx]['txid']){
                                //console.log('ANALYZING VIN ' + vinx)
                                var rawtxvin = await wallet.request('getrawtransaction', [tx['result']['vin'][vinx]['txid']])
                                var txvin = await wallet.request('decoderawtransaction', [rawtxvin['result']])
                                block['result']['tx'][i]['vin'][vinx]['value'] = txvin['result']['vout'][vout]['value']
                                block['result']['totvin'] += txvin['result']['vout'][vout]['value']
                                block['result']['tx'][i]['vin'][vinx]['addresses'] = txvin['result']['vout'][vout]['scriptPubKey']['addresses']
                                for(var key in txvin['result']['vout'][vout]['scriptPubKey']['addresses']){
                                    var address = txvin['result']['vout'][vout]['scriptPubKey']['addresses'][key]
                                    if(block['result']['analysis'][txid]['balances'][address] === undefined){
                                        block['result']['analysis'][txid]['balances'][address] = {}
                                        block['result']['analysis'][txid]['balances'][address]['value'] = 0
                                        block['result']['analysis'][txid]['balances'][address]['type'] = 'TX'
                                        block['result']['analysis'][txid]['balances'][address]['vin'] = 0
                                        block['result']['analysis'][txid]['balances'][address]['vout'] = 0
                                    }
                                    block['result']['analysis'][txid]['balances'][address]['value'] -= txvin['result']['vout'][vout]['value']
                                    block['result']['analysis'][txid]['vin'] += txvin['result']['vout'][vout]['value']
                                    block['result']['analysis'][txid]['balances'][address]['vin'] += txvin['result']['vout'][vout]['value']
                                    txtotvin += txvin['result']['vout'][vout]['value']
                                }
                            }
                        }
                        //PARSING ALL VOUT
                        var receivingaddress = ''
                        for(var voutx = 0; voutx < block['result']['tx'][i]['vout'].length; voutx++){
                            //console.log('ANALYZING VOUT ' + voutx)
                            if(block['result']['tx'][i]['vout'][voutx]['value'] >= 0){
                                block['result']['totvout'] += block['result']['tx'][i]['vout'][voutx]['value']
                                //CHECKING VALUES OUT
                                if(block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['addresses']){
                                    block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['addresses'].forEach(function(address, index){
                                        if(block['result']['analysis'][txid]['balances'][address] === undefined){
                                            block['result']['analysis'][txid]['balances'][address] = {}
                                            block['result']['analysis'][txid]['balances'][address]['value'] = 0
                                            block['result']['analysis'][txid]['balances'][address]['type'] = 'TX'
                                            block['result']['analysis'][txid]['balances'][address]['vin'] = 0
                                            block['result']['analysis'][txid]['balances'][address]['vout'] = 0
                                        }
                                        block['result']['analysis'][txid]['balances'][address]['value'] += block['result']['tx'][i]['vout'][voutx]['value']
                                        block['result']['analysis'][txid]['vout'] += block['result']['tx'][i]['vout'][voutx]['value']
                                        block['result']['analysis'][txid]['balances'][address]['vout'] += block['result']['tx'][i]['vout'][voutx]['value']
                                        txtotvout += block['result']['tx'][i]['vout'][voutx]['value']
                                        receivingaddress = address
                                    })
                                }
                                //CHECKING OP_RETURN
                                if(block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['asm'].indexOf('OP_RETURN') !== -1){
                                    //console.log('CHECKING OP_RETURN')
                                    var parser = new Utilities.Parser
                                    var OP_RETURN = parser.hex2a(block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['asm'].replace('OP_RETURN ',''))
                                    if(block['result']['data'][receivingaddress] === undefined){
                                        block['result']['data'][receivingaddress] = []
                                    }
                                    block['result']['data'][receivingaddress].push(OP_RETURN)
                                }
                            }
                        }

                        //CHECKING GENERATION
                        var generated = 0
                        if(txtotvin < txtotvout){
                            generated = txtotvout - txtotvin
                            block['result']['generated'] = generated 
                        }
                    }

                    //CALCULATING FEES
                    var blocktotvalue = block['result']['totvin'] + block['result']['generated']
                    block['result']['fees'] = (block['result']['totvout'] - blocktotvalue ) * -1
                    
                    //CHECKING TRANSACTION TYPE
                    for(let txid in block['result']['analysis']){
                        block['result']['analysis'][txid]['movements'] = {}
                        block['result']['analysis'][txid]['movements']['from'] = []
                        block['result']['analysis'][txid]['movements']['to'] = []

                        for(let address in block['result']['analysis'][txid]['balances']){
                            if(block['result']['analysis'][txid]['vin'] < block['result']['analysis'][txid]['vout']){
                                if(block['result']['analysis'][txid]['balances'][address]['vin'] > 0){
                                    if(block['result']['analysis'][txid]['balances'][address]['vin'] < block['result']['analysis'][txid]['balances'][address]['vout']){
                                        block['result']['analysis'][txid]['balances'][address]['type'] = 'STAKE'
                                    }
                                }else{
                                    block['result']['analysis'][txid]['balances'][address]['type'] = 'REWARD'
                                }
                            }
                            if(block['result']['analysis'][txid]['balances'][address]['vin'] > 0){
                                block['result']['analysis'][txid]['movements']['from'].push(address)
                            }
                            if(block['result']['analysis'][txid]['balances'][address]['vout'] > 0){
                                block['result']['analysis'][txid]['movements']['to'].push(address)
                            }
                        }
                        
                    }
                    delete block['result']['tx']
                    response(block['result'])
                })   
            })
        })
    }

  }

}

export = Crypto;