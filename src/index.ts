import app from './App'
import * as Crypto from './libs/Crypto'
import * as Daemon from "./libs/Daemon"
import * as Database from "./libs/Database"
import * as Space from "./libs/Space"
import * as Utilities from './libs/Utilities'
const utils = new Utilities.Parser
const fs = require("fs")
const mongo = require('mongodb').MongoClient
const exec = require('child_process')
var publicIp = require('public-ip')
let { nextAvailable } = require('node-port-check')
require('dotenv').config()
const { hashElement } = require('folder-hash')
const CryptoJS = require('crypto-js')
const axios = require('axios')
const console = require('better-console')
var server
global['state'] = 'OFF'
global['db_url'] = 'mongodb://localhost:27017'
global['db_options'] = { useNewUrlParser: true, useUnifiedTopology: true }
global['db_name'] = 'idanodejs'
global['isAnalyzing'] = false
global['retrySync'] = 0
if (process.env.PINIPFS !== undefined && process.env.PINIPFS === 'false') {
  global['pinipfs'] = false
} else if (process.env.PINIPFS === undefined || process.env.PINIPFS === 'true') {
  global['pinipfs'] = true
}
utils.log('IPFS PIN STATUS IS ' + global['pinipfs'])
const rateLimit = require("express-rate-limit");
const helmet = require('helmet')

// SETTING RATE LIMIT
var limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 150
})

if (process.env.RATELIMIT !== undefined) {
  limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: process.env.RATELIMIT
  });
}

const nodeprocess = async () => {
  let port = await nextAvailable(3001, '0.0.0.0')
  app.engine('html', require('ejs').renderFile)
  app.set('trust proxy', 1)
  app.use(limiter)
  app.use(helmet())

  var ip = ''
  try {
    ip = await publicIp.v4()
  } catch (error) {
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

function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function checkConnections() {
  var is_testnet = false
  if (process.env.TESTNET !== undefined) {
    if (process.env.TESTNET === 'true') {
      is_testnet = true
    }
  }

  var wallet = new Crypto.Wallet;
  wallet.request('getinfo').then(async function (info) {
    if (info !== undefined && info['result'] !== null && info['result'] !== undefined && info['result']['blocks'] >= 0) {
      console.log(process.env.COIN + ' wallet successfully connected.')
      try {
        mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
          if (err) {
            console.log('Database not connected, starting process now.')
            try {
              var mongo_path = './mongodb_data'
              if (is_testnet) {
                console.log('RUNNING DATABASE IN TESTNET FOLDER')
                mongo_path += '_testnet'
              }
              if (!fs.existsSync(mongo_path)) {
                fs.mkdirSync(mongo_path);
              }
              exec.exec('mongod --dbpath=' + mongo_path, {
                stdio: 'ignore',
                detached: true
              }).unref()
              console.log('Waiting 5 seconds, then try again.')
              await sleep(5000)
              checkConnections()
            } catch (err) {
              console.log(err)
            }
          } else {
            console.log('Database connected successfully.')
            client.close()
            if (global['state'] === 'OFF') {
              runIdaNode()
            }
            var sync = (process.env.SYNC === 'true')
            global['retrySync']++
            if (sync === true && global['isSyncing'] === false && global['state'] === 'ON' && global['remainingBlocks'] === 0) {
              console.log('Starting sync.')
              global['retrySync'] = 0
              var task = new Daemon.Sync
              task.init()
              if (process.env.S3_BUCKET !== undefined) {
                var space = new Space.syncer
                space.syncSpace()
              }
            }
            utils.log('RETRY SYNC IS ' + global['retrySync'])
            if (global['retrySync'] >= 240) {
              mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                var db = client.db(global['db_name'])
                var task = new Daemon.Sync
                const last = await db.collection('blocks').find().sort({ block: -1 }).limit(1).toArray()
                db.collection('blocks').deleteOne({ block: last[0].block })
                utils.log('Retry sync is ' + global['retrySync'] + ', forcing sync.')
                global['isSyncing'] = false
                global['retrySync'] = 0
                client.close()
                var task = new Daemon.Sync
                task.init()
                global['state'] = 'ON'
              })
            }
          }
        });
      } catch (e) {
        var mongo_path = './mongodb_data'
        if (is_testnet) {
          console.log('RUNNING DATABASE IN TESTNET FOLDER')
          mongo_path += '_testnet'
        }
        if (!fs.existsSync(mongo_path)) {
          fs.mkdirSync(mongo_path);
        }
        exec.exec('mongod --dbpath=' + mongo_path, {
          stdio: 'ignore',
          detached: true
        }).unref()
        console.log('Waiting 5 seconds, then try again.')
        await sleep(5000)
      }
    } else {
      console.log('Can\'t communicate with wallet, running process now.')
      var testnet_flag = ''
      if (process.env.LYRAPATH !== undefined && process.env.LYRAFOLDER !== undefined) {
        if (is_testnet) {
          testnet_flag = '-testnet'
          console.log('RUNNING WALLET IN TESTNET MODE')
        }
        exec.spawn(process.env.LYRAPATH + '/lyrad ' + '-datadir=' + process.env.LYRAFOLDER, {
          stdio: 'ignore',
          detached: true
        }).unref().catch(e => {
          console.log(e)
        })
      } else {
        if (process.env.LYRAPATH !== undefined) {
          if (is_testnet) {
            testnet_flag = '-testnet'
            console.log('RUNNING WALLET IN TESTNET MODE')
          }
          exec.spawn(process.env.LYRAPATH + '/lyrad', [testnet_flag], {
            stdio: 'ignore',
            detached: true
          }).unref()
        } else {
          console.error('LYRAD NOT RUNNING, PLEASE RUN IT.')
        }
      }
      console.log('Waiting 5 seconds, then check again.')
      await sleep(5000)
      checkConnections()
    }
  })
}

async function checkIntegrity() {
  return new Promise(response => {
    let pkg = require('../package.json')
    console.log('Start identity check, version is ' + pkg.version)
    const options = {
      folders: { exclude: ['.*', 'node_modules', 'test_coverage'] },
      files: { include: ['*.js', '*.json'] }
    };
    hashElement('./dist', options)
      .then(async hash => {
        let sha256 = CryptoJS.SHA256(hash.hash).toString(CryptoJS.enc.Hex)
        let online_check = await returnGitChecksum(pkg.version)
        if (online_check === sha256) {
          response(true)
        } else {
          response(false)
        }
      })
      .catch(error => {
        return console.error('hashing failed:', error);
      })
  })
}

async function returnGitChecksum(version) {
  const app = this
  return new Promise(async response => {
    try {
      let checksums_git = await axios.get('https://raw.githubusercontent.com/scryptachain/scrypta-idanodejs/master/checksum', { timeout: 10000 }).catch(e => {
        console.error(e)
        response(false)
      })
      let checksums = checksums_git.data.split("\n")
      for (let x in checksums) {
        let checksum = checksums[x].split(':')
        if (checksum[0] === version) {
          response(checksum[1])
        }
      }
      response(false)
    } catch (e) {
      console.log(e, '', 'errors')
      response(false)
    }
  })
}

async function runIdaNode() {
  console.log('Starting database check.')
  var DB = new Database.Management
  var result = await DB.check()
  console.log(result)
  var sync = (process.env.SYNC === 'true')
  // CHECKING CONNETIONS EVERY 1 SECOND
  let valid = await checkIntegrity()
  if (!valid) {
    console.error('IDANODE IS CORRUPTED, PLEASE CHECK FILES!')
  } else {
    console.info('IDANODE IS VALID.')
  }
  
  setInterval(function () {
    checkConnections()
  }, 5000)

  if (sync === true) {
    global['state'] = 'ON'
  } else {
    console.log('Automatic sync is turned off.')
  }
}

nodeprocess()