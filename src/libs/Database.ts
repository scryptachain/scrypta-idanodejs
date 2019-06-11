"use strict";
import express = require("express")
const r = require('rethinkdb')

module Database {

  export class Management {

    public async check() {
        return new Promise(async response => {
            var conn = await r.connect({})
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
            var tables = ["settings", "transactions", "received", "written"]
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
            
            //CHECKING INDEXES
            var txIndexes = ["address", "txid", "time"]
            var exsistingIndexes = await r.table('transactions').indexList().run(conn)
            for(var tdi in txIndexes){
                await r.table('transactions').indexList().contains(txIndexes[tdi])
                .do(function(indexExsists){
                    return r.branch(
                        indexExsists,
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

            response('Database and tables are ok.')
        })
    }

  }

}

export = Database;