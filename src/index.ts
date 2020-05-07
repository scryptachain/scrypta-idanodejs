import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"
const fs = require("fs")
const mongo = require('mongodb').MongoClient
const exec = require('child_process')
var publicIp = require('public-ip')
let {nextAvailable} = require('node-port-check')
require('dotenv').config()
var server
global['state'] = 'OFF'
global['db_url'] = 'mongodb://localhost:27017'
global['db_options'] = {useNewUrlParser: true, useUnifiedTopology: true }
global['db_name'] = 'idanodejs'

const nodeprocess = async () => {
  let port = await nextAvailable(3001, '0.0.0.0')
  app.engine('html', require('ejs').renderFile)
  var ip = ''
  try{
    ip = await publicIp.v4()
  }catch(error){
    ip = '?'
  }
  server = app.listen(port, (err) => {
    if (err) {
      return console.log(err)
    }
    checkConnections()
    return console.log(`Scrypta IdaNode listening at port ${port}. Public IP is: ${ip}`)  
  })

}

function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function checkConnections(){
  var is_testnet = false
  if(process.env.TESTNET !== undefined){
    if(process.env.TESTNET === 'true'){
      is_testnet = true
    }
  }

  var wallet = new Crypto.Wallet;
  wallet.request('getinfo').then( async function(info){
    if(info !== undefined && info['result'] !== null && info['result'] !== undefined && info['result']['blocks'] >= 0){
      console.log(process.env.COIN + ' wallet successfully connected.')
      try{
        mongo.connect(global['db_url'], global['db_options'], async function(err, client) {
          if(err){
            console.log('Database not connected, starting process now.')
            try{
              var mongo_path = './mongodb_data'
              if(is_testnet){
                console.log('RUNNING DATABASE IN TESTNET FOLDER')
                mongo_path += '_testnet'
              }
              if (!fs.existsSync(mongo_path)) {
                fs.mkdirSync(mongo_path);
              }
              exec.exec('mongod --dbpath=' + mongo_path,{
                stdio: 'ignore',
                detached: true
              }).unref()
              console.log('Waiting 5 seconds, then try again.')
              await sleep(5000)
              checkConnections()
            }catch(err){
              console.log(err)
            }
          }else{
            console.log('Database connected successfully.')
            if(global['state'] === 'OFF'){
              runIdaNode()
            }
            var sync = (process.env.SYNC === 'true')
            if(sync === true && global['isSyncing'] === false && global['state'] === 'ON'){
              console.log('Starting sync.')
              var task = new Daemon.Sync
              task.init()
            }
            client.close()
          }
        });
      }catch(e){
        var mongo_path = './mongodb_data'
        if(is_testnet){
          console.log('RUNNING DATABASE IN TESTNET FOLDER')
          mongo_path += '_testnet'
        }
        if (!fs.existsSync(mongo_path)) {
          fs.mkdirSync(mongo_path);
        }
        exec.exec('mongod --dbpath=' + mongo_path,{
          stdio: 'ignore',
          detached: true
        }).unref()
        console.log('Waiting 5 seconds, then try again.')
        await sleep(5000)
      }
    }else{
      console.log('Can\'t communicate with wallet, running process now.')
      var testnet_flag = ''
      if(is_testnet){
          testnet_flag = '-testnet'
          console.log('RUNNING WALLET IN TESTNET MODE')
      }
      if(process.env.LYRAFOLDER !== undefined){
        exec.spawn(process.env.LYRAPATH + '/lyrad ' + '-datadir=' + process.env.LYRAFOLDER,{
          stdio: 'ignore',
          detached: true
        }).unref().catch(e => {
          console.log(e)
        })
      }else{
        exec.spawn(process.env.LYRAPATH + '/lyrad', [testnet_flag],{
          stdio: 'ignore',
          detached: true
        }).unref()
      }
      console.log('Waiting 5 seconds, then check again.')
      await sleep(5000)
      checkConnections()
    }
  })
}

async function runIdaNode(){
  console.log('Starting database check.')
  var DB = new Database.Management
  var result = await DB.check()
  console.log(result)
  var sync = (process.env.SYNC === 'true')
  // CHECKING CONNETIONS EVERY 5 SECONDS
  setInterval(function(){
    checkConnections()
  },5000)
  
  if(sync === true){
    global['state'] = 'ON'
  }else{
    console.log('Automatic sync is turned off.')
  }
}

nodeprocess()