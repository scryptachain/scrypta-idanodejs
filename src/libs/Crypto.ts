"use strict";
import * as Utilities from './Utilities'
import Trx from '../libs/trx/trx.js'
const r = require('rethinkdb')
let request = require("request")
var watchinglist = []

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

    public async listunpent(address){
        return new Promise <any> (async response => {
            var conn = await r.connect({db: 'idanodejs'})
            r.table('unspent').getAll(address, {index: 'address'}).run(conn, function(err, cursor) {
                if(err) {
                    console.log(err)
                }

                cursor.toArray(function(err, result) {
                    if(err) {
                        console.log(err)
                    }

                    var list = result
                    var unspent = []

                    for(var index in list){
                        var tx = list[index]
                        unspent.push(tx)
                    }

                    unspent.sort((a, b) => Number(b.block) - Number(a.block))
                    response(unspent)
                });
            });
        });
    }

    public async send(private_key, from, to, amount, metadata = '', fees = 0.001, send = true){
        return new Promise (async response => {
            var wallet = new Crypto.Wallet;
            
            var unspent = []
            for(let x in global['utxocache']){
                unspent.push(global['utxocache'][x])
            }
            let blockchainunspent = await wallet.listunpent(from)
            for(let y in blockchainunspent){
                unspent.push(blockchainunspent[y])
            }
            var usedtx = []
            if(unspent.length > 0){
                var inputamount = 0;
                var trx = Trx.transaction();
                for (var i=0; i < unspent.length; i++){
                    if(inputamount <= amount){
                        var txin = unspent[i]['txid'];
                        var index = unspent[i]['vout'];
                        var script = unspent[i]['scriptPubKey'];
                        if(global['txidcache'].indexOf(txin) === -1){
                            trx.addinput(txin,index,script);
                            usedtx.push(txin)
                            inputamount += unspent[i]['amount']
                        }
                    }
                }
                var amountneed = parseFloat(amount) + fees;
                var voutchange = 0
                if(inputamount >= amountneed){
                    var change = inputamount - amountneed;
                    
                    if(amount > 0.00001){
                        trx.addoutput(to,amount);
                        voutchange++
                    }

                    if(change > 0.00001){
                        trx.addoutput(from,change);
                    }

                    if(metadata !== '' && metadata.length <= 80){
                        trx.addmetadata(metadata);
                    }

                    var signed = trx.sign(private_key,1);
                    if(send === true){
                        var txid = <string> await wallet.request('sendrawtransaction',[signed])
                        if(txid['result'] !== null && txid['result'].length === 64){
                            for(let x in usedtx){
                                global['txidcache'].push(usedtx[x])
                                delete global['utxocache'][usedtx[x]]
                            }
                            let decoderawtransaction = await wallet.request('decoderawtransaction', [signed])
                            let decoded = decoderawtransaction['result']
                            if(decoded.vout[0].scriptPubKey.addresses !== undefined){
                                let unspent = {
                                    txid: decoded.txid,
                                    vout: voutchange, 
                                    address: decoded.vout[voutchange].scriptPubKey.addresses[0],
                                    scriptPubKey: decoded.vout[voutchange].scriptPubKey.hex,
                                    amount: decoded.vout[voutchange].value
                                }
                                global['utxocache'][decoded.txid] = unspent
                            }
                        }
                        response(txid['result'])
                    }else{
                        response(signed)
                    }
                }else{
                    console.log('NOT ENOUGH FUNDS, NEEDED ' + amountneed + ' LYRA vs ' + inputamount + ' LYRA')
                    response(false)
                }
            }else{
                response(false)
            }
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
                block['result']['inputs'] = []
                block['result']['outputs'] = []
                block['result']['raw_written'] = {}
                block['result']['data_written'] = {}
                block['result']['data_received'] = {}
                
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
                            var vout = block['result']['tx'][i]['vin'][vinx]['vout']
                            if(block['result']['tx'][i]['vin'][vinx]['txid']){
                                //console.log('ANALYZING VIN ' + vinx)
                                var rawtxvin = await wallet.request('getrawtransaction', [tx['result']['vin'][vinx]['txid']])
                                var txvin = await wallet.request('decoderawtransaction', [rawtxvin['result']])
                                let input = {
                                    txid: tx['result']['vin'][vinx]['txid'],
                                    vout: txvin['result']['vout'][vout]['n']
                                }
                                block['result']['inputs'].push(input)
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
                                        if(receivingaddress === ''){
                                            receivingaddress = address
                                        }

                                        let outputs = {
                                            txid: txid,
                                            vout: voutx, 
                                            address: address,
                                            scriptPubKey: block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['hex'],
                                            amount: block['result']['tx'][i]['vout'][voutx]['value']
                                        }
                                        block['result']['outputs'].push(outputs)
                                    })
                                }
                                //CHECKING OP_RETURN
                                if(block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['asm'].indexOf('OP_RETURN') !== -1){
                                    //console.log('CHECKING OP_RETURN')
                                    var parser = new Utilities.Parser
                                    var OP_RETURN = parser.hex2a(block['result']['tx'][i]['vout'][voutx]['scriptPubKey']['asm'].replace('OP_RETURN ',''))
                                    var addressdata 
                                    var addresswrite = block['result']['tx'][i]['vin'][0]['addresses'][0]
                                    if(addresswrite === receivingaddress){
                                        addressdata = addresswrite
                                        if(block['result']['raw_written'][addressdata] === undefined){
                                            block['result']['raw_written'][addressdata] = []
                                        }
                                        block['result']['raw_written'][addressdata].push(OP_RETURN)
                                    }else{
                                        addressdata = receivingaddress
                                        if(block['result']['data_received'][addressdata] === undefined){
                                            block['result']['data_received'][addressdata] = []
                                        }
                                        block['result']['data_received'][addressdata].push({
                                            txid: txid,
                                            block: block['result']['height'],
                                            address: addressdata,
                                            sender: addresswrite,
                                            data: OP_RETURN
                                        })
                                    }

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

                    //COMPACTING DATA AGAIN
                    for(let addressdata in block['result']['raw_written']){
                        var written = block['result']['raw_written'][addressdata]
                        var singledata = ''
                        console.log(written)
                        for(var wix in written){
                            var data = written[wix]
                            var checkhead = data.substr(0,3)
                            var checkfoot = data.substr(-3)
                            console.log('CHECKING HEAD ' + checkhead)
                            console.log('CHECKING FOOT ' + checkfoot)

                            if(singledata === '' && checkhead === checkfoot && checkhead === '*!*' && checkfoot === '*!*'){
                                singledata = data;
                                if(block['result']['data_written'][addressdata] === undefined){
                                    block['result']['data_written'][addressdata] = []
                                }
                                endofdata = 'Y'
                                console.log('FOUND SINGLE DATA')
                            }else{
                                console.log('CHECK FOR CHUCKED DATA')
                                if(singledata === '' && data.indexOf('*!*') === 0){
                                    console.log('INIT CHUCK SEARCH')
                                    var prevcontrol = data.substr(-6).substr(0,3)
                                    console.log('PREV CONTROL IS ' + prevcontrol)
                                    var nextcontrol = data.substr(-3)
                                    console.log('NEXT CONTROL IS ' + nextcontrol)
                                    var chunkcontrol = prevcontrol + nextcontrol
                                    singledata += '*!*'
                                    console.log('NEED TO FIND ' + chunkcontrol)
                                    var endofdata = 'N'
                                    var idc = 0
                                    var idct = 0
                                    while(endofdata === 'N'){
                                        idct++
                                        console.log('CHECKING INDEX ' + idc)
                                        if(written[idc] !== undefined){
                                            var checkdata = written[idc].substr(0,6)
                                            console.log('CHECKING ' + checkdata + ' AGAINST ' + chunkcontrol)
                                            if(checkdata === chunkcontrol){
                                                console.log('CHUNK FOUND ' + chunkcontrol)
                                                idct = 0
                                                if(checkdata.indexOf('*!*') !== -1){
                                                    singledata += data.substr(6, data.length)
                                                    console.log('END OF DATA')
                                                    endofdata = 'Y';
                                                }else{
                                                    var chunk = data.substr(6, data.length)
                                                    var datalm3 = data.length - 6
                                                    chunk = chunk.substr(0,datalm3)
                                                    singledata += chunk
                                                    console.log('CHUNKED DATA IS ' + chunk)
                                                    if(written[idc] !== undefined){
                                                        var data = written[idc]
                                                        var prevcontrol = data.substr(-6).substr(0,3)
                                                        console.log('PREV CONTROL IS ' + prevcontrol)
                                                        var nextcontrol = data.substr(-3)
                                                        console.log('NEXT CONTROL IS ' + nextcontrol)
                                                        chunkcontrol = prevcontrol + nextcontrol

                                                        if(chunkcontrol.indexOf('*!*') !== -1){
                                                            singledata += data.substr(6, data.length)
                                                            console.log('END OF DATA')
                                                            endofdata = 'Y'
                                                        }else{
                                                            console.log('NEED TO FIND ' + chunkcontrol)
                                                            idc = 0
                                                        }
                                                        idc ++ 
                                                    }else{
                                                        idc = 0
                                                        console.log(written)
                                                        endofdata = 'Y'
                                                    }
                                                }
                                            }else{
                                                idc++
                                            }

                                            if(idct > 100){
                                                endofdata = 'Y'
                                                console.log('MALFORMED DATA, CAN\'T REBUILD')
                                            }
                                        }else{
                                            endofdata = 'Y'
                                        }
                                    }

                                }
                            }

                            checkhead = singledata.substr(0,3)
                            checkfoot = singledata.substr(-3)
                            
                            if(endofdata === 'Y' && checkhead === '*!*' && checkfoot === '*!*'){
                                console.log('COMPLETED DATA ' + singledata)
                                if(block['result']['data_written'][addressdata] === undefined){
                                    block['result']['data_written'][addressdata] = []
                                }
                                singledata = singledata.substr(3)
                                var datalm3 = singledata.length - 3
                                singledata = singledata.substr(0, datalm3)
                                var split = singledata.split('*=>')
                                var headsplit = split[0].split('!*!')
                                var datastore

                                try{
                                    datastore = JSON.parse(split[1]);
                                }catch(e){
                                    datastore = split[1]
                                }
                                if(headsplit[1] !== undefined){
                                    var collection = headsplit[1]
                                }else{
                                    var collection = ''
                                }
                                if(headsplit[2] !== undefined){
                                    var refID = headsplit[2]
                                }else{
                                    var refID = ''
                                }
                                if(headsplit[3] !== undefined){
                                    var protocol = headsplit[3]
                                }else{
                                    var protocol = ''
                                }
                                if(datastore === undefined){
                                    datastore = ''
                                }
                                var parsed = {
                                    address: addressdata,
                                    uuid: headsplit[0],
                                    collection: collection,
                                    refID: refID,
                                    procotol: protocol,
                                    data: datastore,
                                    block: block['result']['height'],
                                    blockhash: block['result']['hash'],
                                    time: block['result']['time']
                                }
                                block['result']['data_written'][addressdata].push(parsed)
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