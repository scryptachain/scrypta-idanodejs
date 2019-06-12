import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"
const r = require('rethinkdb')

let {nextAvailable} = require('node-port-check')
require('dotenv').config()
const axios = require('axios')

const idanodejs = async () => {
  let port = await nextAvailable(3001, '0.0.0.0')
  app.engine('html', require('ejs').renderFile);
  
  app.listen(port, (err) => {
    if (err) {
      return console.log(err)
    }
    var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then( async function(info){
      if(info !== undefined){
        console.log(process.env.COIN + ' wallet successfully connected.')
        r.connect({ host: process.env.DB_HOST, port: process.env.DB_PORT }, async function(err, conn) {
          if(err){
            console.log('Can\'t communicate with database, please check.')
          }else{
            console.log('Starting database and tables check.')
            var DB = new Database.Management
            var result = await DB.check()
            console.log(result)
            console.log('Starting block synchronization.')
            var task
            task = new Daemon.Sync
            task.init()
          }
        })
      }else{
        console.log('Can\'t communicate with wallet, please check RPC.')
      }
    })
    return console.log(`Scrypta IdaNode listening at port ${port}.`)
  })
}

idanodejs()