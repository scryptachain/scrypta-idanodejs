"use strict";
const mongo = require('mongodb').MongoClient


module SideChain {

  export class Wallet {

    public async listunpent(address, sidechain){
        return new Promise <any> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let unspent = await db.collection('sc_unspent').find({address: address, sidechain: sidechain}).sort({block: 1}).toArray()
                for(let x in unspent){
                    delete unspent[x]._id
                }
                client.close()
                response(unspent)
            })
        });
    }

    public async validatesxid(sxid, vout, sidechain){
        return new Promise <boolean> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let unspent = await db.collection('sc_unspent').find({sxid: sxid, vout: vout, sidechain: sidechain}).sort({block: -1}).toArray()
                if(unspent[0] !== undefined){
                    // TODO: CHECKSIG
                    response(true)
                }else{
                    let check_genesis = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                    console.log('CHECK_GENESIS', sxid)
                    if(check_genesis !== undefined && check_genesis[0] !== undefined && check_genesis[0].genesis !== undefined && check_genesis[0].sxid === sxid){
                        response(true)
                    }else{
                        console.log('CHECK_REISSUE')
                        let check_reissue = await db.collection('sc_transactions').find({sxid: sxid}).sort({block: 1}).toArray()
                        if(check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined){
                            let check_sidechain = await db.collection('written').find({ address: check_reissue[0].reissue.sidechain }).sort({ block: 1 }).limit(1).toArray()
                            console.log('CHECK_REISSUE', sxid)
                            if(check_reissue !== undefined && check_reissue[0] !== undefined && check_reissue[0].reissue !== undefined && check_reissue[0].sxid === sxid && check_reissue[0].reissue.owner === check_sidechain[0].data.genesis.owner && check_sidechain[0].data.genesis.reissuable === true){
                                response(true)
                            }else{
                                response(false)
                            }
                        }else{
                            response(false)
                        }
                    }
                }
                client.close()
            })
        });
    }

  }

}

export = SideChain;
