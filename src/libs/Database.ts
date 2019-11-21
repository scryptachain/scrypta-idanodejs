"use strict";
import express = require("express")
const mongo = require('mongodb').MongoClient

module Database {

  export class Management {

    public async check() {
        return new Promise(async response => {
            mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
                const db = client.db(global['db_name'])
                var collections = [
                    {
                        name: "settings",
                        indexes: [],
                        compound: []
                    },
                    {
                        name: "transactions",
                        indexes: ["address", "txid", "time", "block"],
                        compound: [["address","txid"]]
                    },
                    {
                        name: "received",
                        indexes: ["address", "block", "uuid", "collection", "protocol"],
                        compound: [["txid","address"]]
                    },
                    {
                        name: "written",
                        indexes: ["address", "block", "uuid", "collection", "protocol"],
                        compound: [["uuid","block"]]
                    },
                    {
                        name: "unspent",
                        indexes: ["address", "txid"],
                        compound: [["txid","vout"]]
                    },
                    {
                        name: "sc_unspent",
                        indexes: ["address", "sxid"],
                        compound: [["sxid","vout"]]
                    },
                    {
                        name: "sc_transactions",
                        indexes: ["address", "sxid", "time", "block"],
                        compound: [["address","sxid"]]
                    },
                    {
                        name: "initialized",
                        indexes: ["address", "txid"],
                        compound: []
                    },
                ]
                //CHECKING COLLECTIONS
                for(let tdk in collections){
                    let collection = collections[tdk]
                    await db.createCollection(collection.name)
                    console.log("Collection " + collection.name + " created.");
                    //CHECKING INDEXES
                    for(let tik in collection.indexes){
                        let index = collection.indexes[tik]
                        console.log('Checking index ' + index + ' of collection ' + collection.name)
                        let collectionObj = client.db(global['db_name']).collection(collection.name)
                        await collectionObj.createIndex({ [index]: 1 })
                    }
                    for(let tck in collection.compound){
                        let index = collection.compound[tck]
                        console.log('Checking compound index ' + JSON.stringify(index) + ' of collection ' + collection.name)
                        let collectionObj = client.db(global['db_name']).collection(collection.name)
                        let compound = {}
                        for(let tcki in index){
                            compound[index[tcki]] = 1
                        }
                        await collectionObj.createIndex(compound)
                    }
                }
                response('Database and tables are ok.')
            })
        })
    }

  }

}

export = Database;
