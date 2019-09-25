import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"
import SysTray from 'systray'
const open = require('opn')
const r = require('rethinkdb')
const exec = require('child_process')
var publicIp = require('public-ip')
let {nextAvailable} = require('node-port-check')
require('dotenv').config()
var server
global['state'] = 'OFF'

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

  var servermode = (process.env.SERVERMODE === 'true')
  if(servermode === false){
    const systray = new SysTray({
      menu: {
          icon: "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",
          title: "",
          tooltip: "Tips",
          items: [
            {
              title: "Open in Browser",
              tooltip: "Open IdaNode endpoint in default browser",
              checked: false,
              enabled: false
            }, {
              title: "Close",
              tooltip: "Close IdaNode",
              checked: false,
              enabled: true
          }]
      },
      debug: false,
      copyDir: true
    })

    systray.onClick(action => {
      if (action.seq_id === 0) {
        open('http://localhost:' + port)
      } else if (action.seq_id === 1) {
        exec.exec('pkill lyrad', (err, stdout, stderr) => {
          if (err) {
            console.log(stderr);
            return;
          }
          exec.exec('pkill rethinkdb', (err, stdout, stderr) => {
            if (err) {
              console.log(stderr);
              return;
            }
            server.close()
            systray.kill()
            process.exit()
          })
        })
      }
    })
  }
}

function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function checkConnections(){
  var wallet = new Crypto.Wallet;
  wallet.request('getinfo').then( async function(info){
    if(info !== undefined && info['result'] !== null && info['result'] !== undefined && info['result']['blocks'] >= 0){
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
          console.log('Database connected successfully.')
          dbconnected = true
          if(global['state'] === 'OFF'){
            runIdaNode()
            setInterval(function(){
              checkConnections()
            },10000)
          }
        }
      }
    }else{
      console.log('Can\'t communicate with wallet, running process now.')
      exec.spawn(process.env.LYRAPATH + '/lyrad',{
        stdio: 'ignore',
        detached: true
      }).unref()
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
  if(sync === true){
    console.log('Starting block synchronization.')
    var task
    task = new Daemon.Sync
    task.init()
    global['state'] = 'ON'
  }else{
    console.log('Automatic sync is turned off.')
  }
}

nodeprocess()