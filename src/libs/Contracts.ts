"use strict";
const mongo = require('mongodb').MongoClient

module Contracts {

  export class Local {

    public async pinned(){
        return new Promise <any> (async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                let res = {
                    block: [],
                    mempool: []
                }
                
                let eachBlock = await db.collection('contracts').find({ eachBlock: true }).toArray()
                for(let x in eachBlock){
                    res.block.push(eachBlock[x].contract)
                }

                let ifMempool = await db.collection('contracts').find({ ifMempool: true }).toArray()
                for(let x in ifMempool){
                    res.mempool.push(ifMempool[x].contract)
                }

                client.close()
                response(res)
            })
        });
    }

  }

}

export = Contracts;
