"use strict";
import express = require("express")
const r = require('rethinkdb')

module Database {

  export class Management {

    public async check() {
        return new Promise(async response => {
            var conn = await r.connect({ host: process.env.DB_HOST, port: process.env.DB_PORT })
            //CHECKING DATABASE
            await r.dbList().contains('idanodejs')
            .do(function(databaseExists) {
                return r.branch(
                    databaseExists,
                    { dbs_created: 0 },
                    r.dbCreate('idanodejs')
                );
            }).run(conn)

            conn.use('idanodejs')
            //CHECKING TABLES
            var tables = ["settings", "transactions", "received", "written", "unspent"]
            for(var tdk in tables){
                await r.tableList().contains(tables[tdk])
                .do(function(tableExsists){
                    return r.branch(
                        tableExsists,
                        { td_created: 0 },
                        r.tableCreate(tables[tdk])
                    );
                }).run(conn)
            }
            
            //CHECKING SETTINGS INDEXES
            var txIndexes = ["setting"]
            var exsistingIndexes = await r.table('settings').indexList().run(conn)
            for(var tdi in txIndexes){
                await r.table('settings').indexList().contains(txIndexes[tdi])
                .do(function(indexExists){
                    return r.branch(
                        indexExists,
                        { td_created: 0 },
                        r.table("settings").indexCreate(txIndexes[tdi])
                    );
                }).run(conn)
            }

            //CHECKING TRANSACTIONS INDEXES
            var txIndexes = ["address", "txid", "time"]
            var exsistingIndexes = await r.table('transactions').indexList().run(conn)
            for(var tdi in txIndexes){
                await r.table('transactions').indexList().contains(txIndexes[tdi])
                .do(function(indexExists){
                    return r.branch(
                        indexExists,
                        { td_created: 0 },
                        r.table("transactions").indexCreate(txIndexes[tdi])
                    );
                }).run(conn)
            }
            if(exsistingIndexes.indexOf("addresstxid") === -1){
                r.table("transactions").indexCreate(
                    "addresstxid", [r.row("address"), r.row("txid")]
                ).run(conn)
            }

            //CHECKING UNSPENT INDEXES
            var txIndexes = ["address", "txid"]
            var exsistingIndexes = await r.table('unspent').indexList().run(conn)
            for(var tdi in txIndexes){
                await r.table('unspent').indexList().contains(txIndexes[tdi])
                .do(function(indexExists){
                    return r.branch(
                        indexExists,
                        { td_created: 0 },
                        r.table("unspent").indexCreate(txIndexes[tdi])
                    );
                }).run(conn)
            }
            if(exsistingIndexes.indexOf("txidvout") === -1){
                r.table("unspent").indexCreate(
                    "txidvout", [r.row("txid"), r.row("vout")]
                ).run(conn)
            }
            
            //CHECKING DATA INDEXES
            var txIndexes = ["address", "block", "uuid", "collection", "protocol"]
            var exsistingIndexes = await r.table('written').indexList().run(conn)
            
            for(var tdi in txIndexes){
                await r.table('written').indexList().contains(txIndexes[tdi])
                .do(function(indexExists){
                    return r.branch(
                        indexExists,
                        { td_created: 0 },
                        r.table("written").indexCreate(txIndexes[tdi])
                    );
                }).run(conn)
            }

            if(exsistingIndexes.indexOf("uuidblock") === -1){
                r.table("written").indexCreate(
                    "uuidblock", [r.row("uuid"), r.row("block")]
                ).run(conn)
            }

            var txIndexes = ["address", "block", "uuid", "collection", "protocol"]
            var exsistingIndexes = await r.table('received').indexList().run(conn)
            
            for(var tdi in txIndexes){
                await r.table('received').indexList().contains(txIndexes[tdi])
                .do(function(indexExists){
                    return r.branch(
                        indexExists,
                        { td_created: 0 },
                        r.table("received").indexCreate(txIndexes[tdi])
                    );
                }).run(conn)
            }

            if(exsistingIndexes.indexOf("txidaddress") === -1){
                r.table("received").indexCreate(
                    "txidaddress", [r.row("txid"), r.row("address")]
                ).run(conn)
            }

            response('Database and tables are ok.')
        })
    }

  }

}

export = Database;
