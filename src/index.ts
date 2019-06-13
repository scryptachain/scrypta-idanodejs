import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"
const r = require('rethinkdb')
const exec = require('child_process')

let {nextAvailable} = require('node-port-check')
require('dotenv').config()
const axios = require('axios')

const nodeprocess = async () => {
  let port = await nextAvailable(3001, '0.0.0.0')
  app.engine('html', require('ejs').renderFile);
  
  app.listen(port, (err) => {
    if (err) {
      return console.log(err)
    }
    runIdaNode()
    return console.log(`Scrypta IdaNode listening at port ${port}.`)
      
  })
}

function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function runIdaNode(){
  var wallet = new Crypto.Wallet;
    wallet.request('getinfo').then( async function(info){
      if(info !== undefined && info['result'] !== null && info['result']['blocks'] >= 0){
        console.log(process.env.COIN + ' wallet successfully connected.')
        var dbconnected = false
        while(dbconnected === false){
          var conn = await r.connect({ host: process.env.DB_HOST, port: process.env.DB_PORT }).catch(async err => {
            console.log('Can\'t communicate with database, running process now.')
            exec.spawn('rethinkdb',{
              stdio: 'ignore',
              detached: true
            }).unref()
            console.log('Waiting 5 seconds, then try again.')
            await sleep(5000)
          })
          if(conn !== undefined){
            dbconnected = true
            console.log('Starting database and tables check.')
            var DB = new Database.Management
            var result = await DB.check()
            console.log(result)
            console.log('Starting block synchronization.')
            var task
            task = new Daemon.Sync
            task.init()
          }
        }
      }else{
        console.log('Can\'t communicate with wallet, running process now.')
        exec.spawn(process.env.LYRAPATH + '/lyrad',{
          stdio: 'ignore',
          detached: true
        }).unref()
        console.log('Waiting 5 seconds, then restart IdaNode.')
        await sleep(5000)
        runIdaNode()
      }
    })
}

nodeprocess()