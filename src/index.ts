import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"

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
        let db = await axios.get('http://localhost:' + process.env.COUCHDBPORT)
        if(db.data.uuid !== undefined){
          console.log('CouchDB ready at port ' + process.env.COUCHDBPORT + ', checking databases.')
          var dbManagement = new Database.Management
          var check = await dbManagement.check()
          console.log(check)
          console.log('Starting block synchronization.')
          var task
          task = new Daemon.Sync
          task.init()
        }else{
          console.log('Can\'t communicate with database, please check CouchDB.')
        }
      }else{
        console.log('Can\'t communicate with wallet, please check RPC.')
      }
    })
    return console.log(`Scrypta IdaNode listening at port ${port}.`)
  })
}

idanodejs()