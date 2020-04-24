"use strict";
const mongo = require('mongodb').MongoClient
import * as Crypto from './Crypto'

module SideChain {

  export class Wallet {

    public async listunspent(address, sidechain){
        return new Promise <any> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let res = []
                let uniq = []
                let unspent = await db.collection('sc_unspent').find({address: address, sidechain: sidechain, redeemed: null, redeemblock: null}).sort({ block: -1 }).toArray()
                for(let x in unspent){
                    delete unspent[x]._id
                    if(uniq.indexOf(unspent[x].sxid+':'+unspent[x].vout) === -1){
                        uniq.push(unspent[x].sxid+':'+unspent[x].vout)
                        res.push(unspent[x])
                    }
                }
                client.close()
                response(res)
            })
        });
    }

    public async validategenesis(sxid, sidechain){
        return new Promise <boolean> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let check_genesis = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                console.log('CHECK_GENESIS')
                if(check_genesis !== undefined && check_genesis[0] !== undefined && check_genesis[0].genesis !== undefined && check_genesis[0].sxid === sxid){
                    response(true)
                }else{
                    console.log('CHECK_REISSUE')
                    let check_reissue = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                    if(check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined){
                        let check_sidechain = await db.collection('written').find({ address: check_reissue[0].reissue.sidechain }).sort({ block: 1 }).limit(1).toArray()
                        client.close()
                        if(check_reissue !== undefined && check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined && check_reissue[0].sxid === sxid && check_reissue[0].reissue.owner === check_sidechain[0].data.genesis.owner && check_sidechain[0].data.genesis.reissuable === true){
                            response(true)
                        }else{
                            response(false)
                        }
                    }else{
                        client.close()
                        response(false)
                    }
                }
            })
        });
    }

    public async validateinput(sxid, vout, sidechain, address, block = ''){
        return new Promise <boolean> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                const db = client.db(global['db_name'])
                let valid = false
                if(block === ''){
                    let wallet = new Crypto.Wallet
                    let request = await wallet.request('getinfo')
                    block = request['result'].blocks
                }
                
                // CHECKING IF UNSPENT EXISTS
                let sxidcheck = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain, "sxid": sxid, redeemed: null, redeemblock: null }).sort({ block: 1 }).limit(1).toArray()
                let voutx = 0
                if(sxidcheck[0] !== undefined){
                    if(sxidcheck[0].transaction !== undefined){
                        for(let x in sxidcheck[0].transaction.outputs){
                            if(voutx === vout){
                                if(x === address){
                                    valid = true
                                }
                            }
                            voutx++
                        }
                    }
                }
                console.log('UNSPENT EXIST', valid)
                // CHECKING IF UNSPENT IS NOT DOUBLE SPENDED
                let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain }).sort({ block: 1 }).toArray()
                for(let x in sidechain_datas){
                    let transaction = sidechain_datas[x]
                    if(transaction.block < block){
                        for(let y in transaction.transaction.inputs){
                            let input = transaction.transaction.inputs[y]
                            if(input.sxid === sxid && input.vout === vout){
                                valid = false
                            }
                        }
                    }
                }
                console.log('IS NOT DOUBLE SPENDED', valid)
                client.close()
                response(valid)
            })
        })
    }

    public async checkdoublespending(sxid, vout, sidechain, incomingSxid){
        return new Promise <boolean> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                const db = client.db(global['db_name'])
                let invalid = false
                // CHECKING IF UNSPENT IS NOT DOUBLE SPENDED
                let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain }).sort({ block: 1 }).toArray()
                for(let x in sidechain_datas){
                    let transaction = sidechain_datas[x]
                    for(let y in transaction.transaction.inputs){
                        let input = transaction.transaction.inputs[y]
                        if(input.sxid === sxid && input.vout === vout && transaction.transaction.sxid !== incomingSxid){
                            invalid = true
                        }
                    }
                }
                console.log('DOUBLE SPENDING', invalid)
                client.close()
                response(invalid)
            })
        })
    }
  }

}

export = SideChain;
