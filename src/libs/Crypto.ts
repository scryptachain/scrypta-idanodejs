"use strict";
import * as Utilities from './Utilities'
import Trx from '../libs/trx/trx.js'
const mongo = require('mongodb').MongoClient
let request = require("request")
let CoinKey = require("coinkey")
const CryptoJS = require('crypto-js')
var cs = require('coinstring')
var crypto = require('crypto')
const secp256k1 = require('secp256k1')
const lyraInfo = global['lyraInfo']

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

    public async signmessage(key, message){
        return new Promise <any> (async response => {
            var ck = CoinKey.fromWif(key, lyraInfo);
            let hash = CryptoJS.SHA256(message);
            let msg = Buffer.from(hash.toString(CryptoJS.enc.Hex), 'hex');
            let privKey = ck.privateKey
            const sigObj = secp256k1.sign(msg, privKey)
            const pubKey = secp256k1.publicKeyCreate(privKey)
            let id = CryptoJS.SHA256(sigObj.signature.toString('hex'));
            response({
                message: message,
                hash: hash.toString(CryptoJS.enc.Hex),
                signature: sigObj.signature.toString('hex'),
                id: id.toString(CryptoJS.enc.Hex),
                pubkey: pubKey.toString('hex'),
                address: ck.publicAddress
            })
        })
    }

    public async getAddressFromPubKey(pubKey){
        return new Promise(response => {
            let pubkeybuffer = new Buffer(pubKey,'hex')
            var sha = crypto.createHash('sha256').update(pubkeybuffer).digest()
            let pubKeyHash = crypto.createHash('rmd160').update(sha).digest()
            var hash160Buf = new Buffer(pubKeyHash, 'hex')
            response(cs.encode(hash160Buf, lyraInfo.public)) 
        })
    }

    public async verifymessage(pubkey, signature, message){
        return new Promise(async response => {
            //CREATE HASH FROM MESSAGE
            const wallet = new Crypto.Wallet
            let hash = CryptoJS.SHA256(message)
            let msg = Buffer.from(hash.toString(CryptoJS.enc.Hex), 'hex')
            //VERIFY MESSAGE
            let buf = Buffer.from(signature,'hex')
            let pubKey = Buffer.from(pubkey,'hex')
            let verified = secp256k1.verify(msg, buf, pubKey)
            let address = await wallet.getAddressFromPubKey(pubkey)
            if(verified === true){
                response({
                    address: address,
                    pubkey: pubkey,
                    signature: signature,
                    hash: hash.toString(CryptoJS.enc.Hex),
                    message: message,
                })
            }else{
                response(false)
            }
        })
    }

    public async listunpent(address){
        return new Promise <any> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let unspent = await db.collection('unspent').find({address: address}).sort({block: 1}).toArray()
                client.close()
                response(unspent)
            })
        });
    }

    public async send(private_key, from, to, amount, metadata = '', fees = 0.001, send = true){
        return new Promise (async response => {
            var wallet = new Crypto.Wallet;

            var unspent = []
            for(let x in global['utxocache']){
                if(global['utxocache'][x]['address'] === from){
                    unspent.push(global['utxocache'][x])
                }
            }
            let blockchainunspent = await wallet.listunpent(from)
            for(let y in blockchainunspent){
                unspent.push(blockchainunspent[y])
            }
            var usedtx = []
            if(unspent.length > 0){
                var inputamount = 0;
                var trx = Trx.transaction();
                for (let i in unspent){
                    var amountneed = parseFloat(amount) + fees;
                    if(inputamount <= amountneed){
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
                                console.log("UNSPENT IS: ",unspent)
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

    public async send2multisig(private_key, from, to, amount, metadata = '', fees = 0.001, send = true){
        return new Promise (async response => {
            var wallet = new Crypto.Wallet;

            var unspent = []
            for(let x in global['utxocache']){
                if(global['utxocache'][x]['address'] === from){
                    unspent.push(global['utxocache'][x])
                }
            }
            let blockchainunspent = await wallet.listunpent(from)
            for(let y in blockchainunspent){
                unspent.push(blockchainunspent[y])
            }
            var inputs = []
            var outputs = {}
            if(unspent.length > 0){
                var inputamount
                inputamount = 0
                for (let i in unspent){
                    var amountneed = parseFloat(amount) + fees;
                    if(inputamount <= amountneed){
                        var txin = unspent[i]['txid'];
                        var index = unspent[i]['vout'];
                        var script = unspent[i]['scriptPubKey'];
                        if(global['txidcache'].indexOf(txin) === -1){
                            inputs.push({
                                "txid": txin,
                                "vout": index,
                                "scriptPubKey": script
                            })
                            inputamount += parseFloat(unspent[i]['amount'])
                        }
                    }
                }
                var voutchange = 0
                if(inputamount >= amountneed){
                    let change = parseFloat(inputamount) - amountneed;

                    if(amount > 0.00001){
                        outputs[to] = parseFloat(amount)
                        voutchange++
                    }

                    if(change > 0.00001){
                        outputs[from] = change
                    }

                    var rawtx = <string> await wallet.request('createrawtransaction',[inputs,outputs])
                    var sign = <string> await wallet.request('signrawtransaction',[rawtx['result'],inputs,[private_key]])
                    var signed = sign['result']['hex']
                    
                    if(send === true){
                        var txid = <string> await wallet.request('sendrawtransaction',[signed])
                        if(txid['result'] !== null && txid['result'].length === 64){
                            for(let x in inputs){
                                global['txidcache'].push(inputs[x])
                                delete global['utxocache'][inputs[x]]
                            }
                            let decoderawtransaction = await wallet.request('decoderawtransaction', [signed])
                            let decoded = decoderawtransaction['result']
                            for(let vox in decoded.vout){
                                let unspent = {
                                    txid: decoded.txid,
                                    vout: vox,
                                    address: decoded.vout[vox].scriptPubKey.addresses[0],
                                    scriptPubKey: decoded.vout[vox].scriptPubKey.hex,
                                    amount: decoded.vout[vox].value
                                }
                                global['utxocache'][decoded.txid + ':' + vox] = unspent
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

    public async sendmultisig(private_keys, from, to, amount, metadata = '', redeemScript, fees = 0.001, send = true){
        return new Promise (async response => {
            var wallet = new Crypto.Wallet;

            var unspent = []
            for(let x in global['utxocache']){
                if(global['utxocache'][x]['address'] === from){
                    global['utxocache'][x]['vout'] = parseInt(global['utxocache'][x]['vout'])
                    unspent.push(global['utxocache'][x])
                }
            }
            let blockchainunspent = await wallet.listunpent(from)
            for(let y in blockchainunspent){
                unspent.push(blockchainunspent[y])
            }
            var usedtx = []
            var inputs = []
            var outputs = {}
            if(unspent.length > 0){
                var inputamount = 0;
                var trx = Trx.transaction();
                for (let i in unspent){
                    var amountneed = parseFloat(amount) + fees;
                    if(inputamount <= amountneed){
                        var txin = unspent[i]['txid'];
                        var index = unspent[i]['vout'];
                        var script = unspent[i]['scriptPubKey'];
                        if(global['txidcache'].indexOf(txin) === -1){
                            trx.addinput(txin,index,script);
                            usedtx.push(txin)
                            inputamount += unspent[i]['amount']

                            inputs.push({
                              txid: txin,
                              vout: index,
                              scriptPubKey: script,
                              redeemScript: redeemScript
                            })
                        }
                    }
                }
                var voutchange = 0
                if(inputamount >= amountneed){
                    var change = inputamount - amountneed;

                    if(amount > 0.00001){
                        trx.addoutput(to,amount);
                        outputs[to] = amount
                        voutchange++
                    }

                    if(change > 0.00001){
                        trx.addoutput('LRWEsyi8WPECZGu8XsVgMrz5ah93wkwd5H',change); //Adding dummy address output
                        outputs[from] = change
                    }

                    if(metadata !== '' && metadata.length <= 80){
                        trx.addmetadata(metadata);
                    }
                    let middle = trx.serialize()

                    private_keys = private_keys.split(',')
                    let serialized = <string> await wallet.request('createrawtransaction',[inputs, outputs])
                    let serialized_decoded = <string> await wallet.request('decoderawtransaction',[serialized['result']])
                    
                    let hex = serialized_decoded['result']['vout'][voutchange]['scriptPubKey']['hex']
                    let raw = middle.replace('1976a91444e547eda60eb55127aae6392b84098b30af361088ac', '17' + hex)
                    var sign = <string> await wallet.request('signrawtransaction',[raw, inputs, private_keys])
                    var signed = sign['result']['hex']

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
                                console.log("UNSPENT IS",unspent)
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

    public async writemultisig(private_keys, trustlink, redeemScript, dataToWrite, uuid, collection, refID, protocol){
        return new Promise(async response => {
            var wallet = new Crypto.Wallet;
            if(dataToWrite.length <= 80){
                let txid = ''
                var i = 0
                var totalfees = 0
                var error = false
                while(txid.length !== 64 && error == false){
                    var fees = 0.001 + (i / 1000)
                    txid = <string> await wallet.sendmultisig(private_keys,trustlink,trustlink,0,dataToWrite,redeemScript,fees,true)

                    if(txid !== null && txid.length === 64){
                        console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                        totalfees += fees
                    }else{
                      console.log('TX FAILED.')
                    }

                    i++;
                    if(i > 20){
                        error = true
                        txid = '0000000000000000000000000000000000000000000000000000000000000000'
                    }
                }
                if(error === false){
                    response({
                        uuid: uuid,
                        address: wallet,
                        fees: totalfees,
                        collection: collection.replace('!*!',''),
                        refID: refID.replace('!*!',''),
                        protocol: protocol.replace('!*!',''),
                        dimension: dataToWrite.length,
                        chunks: 1,
                        stored: dataToWrite,
                        txs: [txid]
                    })
                }else{
                    response(false)
                }

            }else{

                var txs = []
                var dataToWriteLength = dataToWrite.length
                var nchunks = Math.ceil(dataToWriteLength / 74)
                var last = nchunks - 1
                var chunks = []

                for (var i=0; i<nchunks; i++){
                    var start = i * 74
                    var end = start + 74
                    var chunk = dataToWrite.substring(start,end)
                    var prevref
                    var nextref
                    if(i === 0){
                        var startnext = (i + 1) * 74
                        var endnext = startnext + 74
                        prevref = ''
                        nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                    } else if(i === last){
                        var startprev = (i - 1) * 74
                        var endprev = startprev + 74
                        nextref = ''
                        prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                    } else {
                        var sni = i + 1
                        var startnext = sni * 74
                        var endnext = startnext + 74
                        nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                        var spi = i - 1
                        var startprev = spi * 74
                        var endprev = startprev + 74
                        prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                    }
                    chunk = prevref + chunk + nextref
                    chunks.push(chunk)
                }

                var totalfees = 0
                var error = false

                for(var cix=0; cix<chunks.length; cix++){
                    var txid = ''
                    var i = 0
                    while(txid !== null && txid !== undefined && txid.length !== 64){
                        var fees = 0.001 + (i / 1000)

                        txid = <string> await wallet.sendmultisig(private_keys,trustlink,trustlink,0,chunks[cix],redeemScript,fees,true)
                        if(txid !== null && txid.length === 64){
                            console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                            totalfees += fees
                            txs.push(txid)
                        }else{
                          console.log('TX FAILED.')
                        }

                        i++;
                        if(i > 20){
                            error = true
                            txid = '0000000000000000000000000000000000000000000000000000000000000000'
                        }
                    }
                }

                if(error === false){
                    response({
                        uuid: uuid,
                        address: trustlink,
                        fees: totalfees,
                        collection: collection.replace('!*!',''),
                        refID: refID.replace('!*!',''),
                        protocol: protocol.replace('!*!',''),
                        dimension: dataToWrite.length,
                        chunks: nchunks,
                        stored: dataToWrite,
                        txs: txs
                    })
                }else{
                    response(false)
                }
            }
        })
    }

    public async write(private_key, dapp_address, dataToWrite, uuid, collection, refID, protocol){
        return new Promise(async response => {
            var wallet = new Crypto.Wallet;
            if(dataToWrite.length <= 80){
                let txid = ''
                var i = 0
                var totalfees = 0
                var error = false
                while(txid.length !== 64 && error == false){
                    var fees = 0.001 + (i / 1000)

                    txid = <string> await wallet.send(private_key,dapp_address,dapp_address,0,dataToWrite,fees,true)
                    if(txid !== null && txid.length === 64){
                        console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                        totalfees += fees
                    }

                    i++;
                    if(i > 20){
                        error = true
                        txid = '0000000000000000000000000000000000000000000000000000000000000000'
                    }
                }
                if(error === false){
                    response({
                        uuid: uuid,
                        address: wallet,
                        fees: totalfees,
                        collection: collection.replace('!*!',''),
                        refID: refID.replace('!*!',''),
                        protocol: protocol.replace('!*!',''),
                        dimension: dataToWrite.length,
                        chunks: 1,
                        stored: dataToWrite,
                        txs: [txid]
                    })
                }else{
                    response(false)
                }
            }else{

                var txs = []
                var dataToWriteLength = dataToWrite.length
                var nchunks = Math.ceil(dataToWriteLength / 74)
                var last = nchunks - 1
                var chunks = []

                for (var i=0; i<nchunks; i++){
                    var start = i * 74
                    var end = start + 74
                    var chunk = dataToWrite.substring(start,end)
                    var nextref
                    var prevref
                    if(i === 0){
                        var startnext = (i + 1) * 74
                        var endnext = startnext + 74
                        prevref = ''
                        nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                    } else if(i === last){
                        var startprev = (i - 1) * 74
                        var endprev = startprev + 74
                        nextref = ''
                        prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                    } else {
                        var sni = i + 1
                        var startnext = sni * 74
                        var endnext = startnext + 74
                        nextref = dataToWrite.substring(startnext,endnext).substring(0,3)
                        var spi = i - 1
                        var startprev = spi * 74
                        var endprev = startprev + 74
                        prevref = dataToWrite.substr(startprev,endprev).substr(71,3)
                    }
                    chunk = prevref + chunk + nextref
                    chunks.push(chunk)
                }

                var totalfees = 0
                var error = false

                for(var cix=0; cix<chunks.length; cix++){
                    var txid = ''
                    var i = 0
                    var rawtransaction
                    while(txid !== null && txid !== undefined && txid.length !== 64){
                        var fees = 0.001 + (i / 1000)

                        txid = <string> await wallet.send(private_key,dapp_address,dapp_address,0,chunks[cix],fees,true)
                        if(txid !== null && txid.length === 64){
                            console.log('SEND SUCCESS, TXID IS: ' + txid +'. FEES ARE: ' + fees + 'LYRA')
                            totalfees += fees
                            txs.push(txid)
                        }

                        i++;
                        if(i > 20){
                            error = true
                            txid = '0000000000000000000000000000000000000000000000000000000000000000'
                        }
                    }
                }
                if(error === false){
                    if(txs.length === chunks.length){
                        response({
                            uuid: uuid,
                            address: dapp_address,
                            fees: totalfees,
                            collection: collection.replace('!*!',''),
                            refID: refID.replace('!*!',''),
                            protocol: protocol.replace('!*!',''),
                            dimension: dataToWrite.length,
                            chunks: nchunks,
                            stored: dataToWrite,
                            txs: txs
                        })
                    }else{
                        response(false)
                    }
                }else{
                    response(false)
                }
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
                        var written = []
                        
                        if(global['chunkcache'][addressdata] !== undefined){
                            for(let y in global['chunkcache'][addressdata]){
                                written.push(global['chunkcache'][addressdata][y])
                            }
                        }
                        
                        for(let y in block['result']['raw_written'][addressdata]){
                            written.push(block['result']['raw_written'][addressdata][y])
                        }

                        var singledata = ''
                        var readchunks = []
                        console.log('WRITTEN DATA FOUND FOR ADDRESS ' + addressdata, written)
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
                                    console.log('SINGLEDATA IS', singledata)
                                    console.log('NEED TO FIND ' + chunkcontrol)
                                    var endofdata = 'N'
                                    var idc = 0
                                    var idct = 0
                                    var idctt = 0
                                    while(endofdata === 'N'){
                                        idct++
                                        idctt++
                                        console.log('CHECKING INDEX ' + idc)
                                        if(written[idc] !== undefined){
                                            var checkdata = written[idc].substr(0,6)
                                            console.log('CHECKING ' + checkdata + ' AGAINST ' + chunkcontrol)
                                            if(checkdata === chunkcontrol && readchunks.indexOf(idc) === -1){
                                                readchunks.push(idc)
                                                console.log('\x1b[33m%s\x1b[0m', 'CHUNK FOUND ' + chunkcontrol + ' at #' + idc)
                                                idct = 0
                                                if(checkdata.indexOf('*!*') !== -1){
                                                    singledata += data.substr(6, data.length)
                                                    console.log('END OF DATA')
                                                    endofdata = 'Y';
                                                }else{
                                                    var chunk = '' 
                                                    var datalm3 = 0
                                                    if(data.indexOf('*!*') === 0 && singledata === '*!*'){
                                                        chunk = data.substr(3, data.length)
                                                        datalm3 = data.length - 3
                                                    }else{
                                                        chunk = data.substr(6, data.length)
                                                        datalm3 = data.length - 6
                                                    }
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
                                                        console.log('RESTARTING')
                                                        //endofdata = 'Y'
                                                    }
                                                }
                                            }else{
                                                idc++
                                            }

                                            let max = 10000 * written.length
                                            if(idctt > max){
                                                endofdata = 'Y'
                                                console.log('\x1b[33m%s\x1b[0m', 'MALFORMED DATA, CAN\'T REBUILD')
                                            }
                                        }else{
                                            //endofdata = 'Y'
                                            idc = 0
                                            console.log('RESTARTING')
                                        }
                                    }

                                }
                            }

                            checkhead = singledata.substr(0,3)
                            checkfoot = singledata.substr(-3)

                            if(endofdata === 'Y' && checkhead === '*!*' && checkfoot === '*!*'){
                                console.log('COMPLETED DATA ' + singledata)
                                if(global['chunkcache'][addressdata] !== undefined){
                                    // RESETTING CACHE DATA
                                    global['chunkcache'][addressdata] = []
                                }
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
                                    protocol: protocol,
                                    data: datastore,
                                    block: block['result']['height'],
                                    blockhash: block['result']['hash'],
                                    time: block['result']['time']
                                }
                                singledata = ''
                                block['result']['data_written'][addressdata].push(parsed)
                            }else{
                                if(global['chunkcache'][addressdata] === undefined){
                                    global['chunkcache'][addressdata] = []
                                }
                                //PUSHING CHUNKS INTO CACHE
                                for(let y in block['result']['raw_written'][addressdata]){
                                    if(global['chunkcache'][addressdata].includes(block['result']['raw_written'][addressdata][y]) === false){
                                        global['chunkcache'][addressdata].push(block['result']['raw_written'][addressdata][y])
                                    }
                                }
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
