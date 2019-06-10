"use strict";
import express = require("express")
require('dotenv').config()
const axios = require('axios')
const nano = require('nano')('http://localhost:'+ process.env.COUCHDBPORT)

module Database {

  export class Management {

    public async check() {
        return new Promise(async response => {
            nano.db.get('explorer').catch(err => {
                nano.db.create('explorer')
                const explorer = nano.use('explorer')
                explorer.insert({value: ''}, 'reset')
                explorer.insert({value: 0 }, 'index')
            })
            nano.db.get('transactions').catch(err => {
                nano.db.create('transactions')
            })
            response('All checks were carried out, database is ready.')
        })
    }

  }

}

export = Database;