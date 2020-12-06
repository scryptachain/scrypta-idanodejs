"use strict";
const mongo = require('mongodb').MongoClient
import * as Crypto from './Crypto'
import * as Utilities from './Utilities'

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
                    let scwallet = new SideChain.Wallet
                    let isDoubleSpended = await scwallet.checkdoublespending(unspent[x].sxid, unspent[x].vout, sidechain)
                    if(uniq.indexOf(unspent[x].sxid+':'+unspent[x].vout) === -1 && isDoubleSpended === false){
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
        let utils = new Utilities.Parser
        return new Promise <boolean> (async response => {
            try{
                mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                    const db = client.db(global['db_name'])
                    let check_genesis = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                    // console.log('CHECK_GENESIS')
                    if(check_genesis !== undefined && check_genesis[0] !== undefined && check_genesis[0].genesis !== undefined && check_genesis[0].sxid === sxid){
                        client.close()
                        response(true)
                    }else{
                        // console.log('CHECK_REISSUE')
                        let check_reissue = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                        if(check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined){
                            let check_sidechain = await db.collection('written').find({ address: check_reissue[0].reissue.sidechain }).sort({ block: 1 }).limit(1).toArray()
                            client.close()
                            if(check_reissue !== undefined && check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined && check_sidechain[0].data.genesis !== undefined && check_reissue[0].sxid === sxid && check_reissue[0].reissue.owner === check_sidechain[0].data.genesis.owner && check_sidechain[0].data.genesis.reissuable === true){
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
            }catch(e){
                utils.log(e, '', 'errors')
                response(false)
            }
        });
    }

    public async checkinputspent(sxid, vout, sidechain, address, block = ''){
        return new Promise <boolean> (async response => {
            let utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    const db = client.db(global['db_name'])
                    let valid = false
                    if(block === ''){
                        let wallet = new Crypto.Wallet
                        let request = await wallet.request('getinfo')
                        block = request['result'].blocks
                    }
                    let utils = new Utilities.Parser

                    // CHECKING IF UNSPENT EXISTS IN LOCAL DATABASE
                    let unspentcheck = await db.collection('sc_unspent').find({ "sidechain": sidechain, "sxid": sxid, "vout": vout }).sort({ block: 1 }).limit(1).toArray()
                    if(unspentcheck[0] !== undefined){
                        // CHECKING IF UNSPENT EXISTS IN TRANSACTION
                        let sxidcheck = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain, "sxid": sxid }).sort({ block: 1 }).limit(1).toArray()
                        let voutx = 0
                        let existat = ''
                        if(sxidcheck[0] !== undefined){
                            if(sxidcheck[0].transaction !== undefined){
                                for(let x in sxidcheck[0].transaction.outputs){
                                    if(voutx === vout){
                                        if(x === address){
                                            valid = true
                                            existat = sxidcheck[0].sxid + ':' + vout
                                        }
                                    }
                                    voutx++
                                }
                            }
                        }
                        if(existat === ''){
                            utils.log('UNSPENT '+sxid+':'+vout+' DOESN\'T EXIST!')
                        }
                    }else{
                        valid = false
                        utils.log('UNSPENT '+sxid+':'+vout+' DOESN\'T EXIST!')
                    }
                    
                    client.close()
                    response(valid)
                })
            }catch(e){
                utils.log(e, '', 'errors')
                response(false)
            }
        })
    }

    public async validateinput(sxid, vout, sidechain, address, incomingSxid = ''){
        return new Promise <boolean> (async response => {
            let utils = new Utilities.Parser
            try{
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    const db = client.db(global['db_name'])
                    let valid = false
                    let utils = new Utilities.Parser

                    // CHECKING IF UNSPENT EXISTS IN LOCAL DATABASE
                    let unspentcheck = await db.collection('sc_unspent').find({ "sidechain": sidechain, "sxid": sxid, "vout": vout }).sort({ block: 1 }).limit(1).toArray()
                    if(unspentcheck[0] !== undefined){
                        if(unspentcheck[0].redeemed === null || unspentcheck[0].redeemed === incomingSxid){
                            // CHECKING IF UNSPENT EXISTS IN TRANSACTION
                            let sxidcheck = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain, "sxid": sxid }).sort({ block: 1 }).limit(1).toArray()
                            let voutx = 0
                            let existat = ''
                            if(sxidcheck[0] !== undefined){
                                if(sxidcheck[0].transaction !== undefined){
                                    for(let x in sxidcheck[0].transaction.outputs){
                                        if(voutx === vout){
                                            if(x === address){
                                                valid = true
                                                existat = sxidcheck[0].sxid + ':' + vout
                                            }
                                        }
                                        voutx++
                                    }
                                }
                            }
                            if(existat === ''){
                                utils.log('CAN\'T FIND UNSPENT IN TRANSACTION '+sxid+':'+vout+' DOESN\'T EXIST!')
                            }
                        }else{
                            utils.log('UNSPENT '+sxid+':'+vout+' REDEEMED YET IN ANOTHER TRANSACTION!')
                        }
                    }else{
                        valid = false
                        utils.log('UNSPENT '+sxid+':'+vout+' DOESN\'T EXIST!')
                    }
                    
                    client.close()
                    response(valid)
                })
            }catch(e){
                utils.log(e, '', 'errors')
                response(false)
            }
        })
    }

    public async checkdoublespending(sxid, vout, sidechain, incomingSxid = ''){
        return new Promise <boolean> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                const db = client.db(global['db_name'])
                let invalid = false
                // CHECKING IF UNSPENT IS NOT DOUBLE SPENDED
                let sidechain_datas = await db.collection('sc_transactions').find({ "transaction.sidechain": sidechain }).sort({ "transaction.time": 1 }).toArray()
                for(let x in sidechain_datas){
                    let transaction = sidechain_datas[x]
                    for(let y in transaction.transaction.inputs){
                        let input = transaction.transaction.inputs[y]
                        if(incomingSxid !== ''){
                            if(input.sxid === sxid && input.vout === vout && transaction.sxid !== incomingSxid){
                                invalid = true
                            }
                        }else{
                            if(input.sxid === sxid && input.vout === vout){
                                invalid = true
                            }
                        }
                    }
                }
                
                client.close()
                response(invalid)
            })
        })
    }

    public async returnsidechainusers(sidechain){
        return new Promise <any> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                const db = client.db(global['db_name'])
                let check_sidechain = await db.collection('written').find({ address: sidechain, "data.genesis": { $exists: true } }).sort({ block: 1 }).limit(1).toArray()
                if(check_sidechain[0] !== undefined){
                    let sidechain_datas = await db.collection('sc_permissions').findOne({ "sidechain_address": sidechain })
                    sidechain_datas.users.push(check_sidechain[0].data.genesis.address)
                    sidechain_datas.validators.push(check_sidechain[0].data.genesis.owner)
                    client.close()
                    response(sidechain_datas)
                }else{
                    response(false)
                }
            })
        })
    }
  }

}

export = SideChain;
