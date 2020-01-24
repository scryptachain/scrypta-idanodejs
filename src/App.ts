import * as express from 'express'
import * as wallet from "./routes/Wallet"
import * as explorer from "./routes/Explorer"
import * as ipfs from "./routes/Ipfs"
import * as trustlink from "./routes/Trustlink"
import * as pdm from "./routes/Pdm"
import * as dapps from "./routes/dApps"
import * as sidechains from "./routes/SideChains"

var bodyParser = require('body-parser')
var cors = require('cors')
const IPFS = require('ipfs')
global['ipfs'] = new IPFS({ repo: 'ipfs_data' })
global['txidcache'] = []
global['utxocache'] = []
global['sxidcache'] = []
global['usxocache'] = []
global['chunkcache'] = []
global['syncLock'] = false
global['syncTimeout'] = null
global['limit'] = 200

if(process.env.TESTNET !== undefined){
  if(process.env.TESTNET === 'true' || process.env.TESTNET === true){
    // TESTNET BLOCKCHAIN PARAMS
    global['lyraInfo'] = {
      private: 0xae,
      public: 0x7f,
      scripthash: 0x13
    }
  }else{
    // MAINNET BLOCKCHAIN PARAMS
    global['lyraInfo'] = {
      private: 0xae,
      public: 0x30,
      scripthash: 0x0d
    }
  }
}else{
  // MAINNET BLOCKCHAIN PARAMS
  global['lyraInfo'] = {
    private: 0xae,
    public: 0x30,
    scripthash: 0x0d
  }
}

class App {
  public express
  public db
  public Wallet

  constructor () {
    const app = this
    app.express = express()

    app.express.use(bodyParser.urlencoded({extended: true, limit: global['limit'] + 'mb'}))
    app.express.use(bodyParser.json())
    app.express.use(express.static('public'))

    var corsOptions = {
      "origin": "*",
      "methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTION",
      "preflightContinue": true,
      "optionsSuccessStatus": 204
    }
    app.express.use(cors(corsOptions))
    app.express.options('*', cors())

    //ADDRESSES
    app.express.post('/init',wallet.init)
    app.express.post('/send',wallet.send)
    app.express.post('/sendrawtransaction', wallet.sendrawtransaction)
    app.express.post('/decoderawtransaction', wallet.decoderawtransaction)

    //WALLET
    app.express.get('/wallet/getinfo',wallet.getinfo)
    app.express.get('/wallet/getnewaddress/:internal',wallet.getnewaddress)
    app.express.get('/wallet/getnewaddress',wallet.getnewaddress)
    app.express.get('/wallet/masternodelist',wallet.getmasternodelist)

    //PROGRESSIVE DATA MANAGEMENT
    app.express.post('/write', pdm.write)
    app.express.post('/read', pdm.read)
    app.express.post('/invalidate', pdm.invalidate)
    app.express.post('/received', pdm.received)

    //TRUSTLINK
    app.express.post('/trustlink/init', trustlink.init)
    app.express.post('/trustlink/write', trustlink.write)
    app.express.post('/trustlink/send', trustlink.send)
    app.express.post('/trustlink/invalidate', trustlink.invalidate)

    //SIDECHAINS
    app.express.post('/sidechain/issue', sidechains.issue)
    app.express.post('/sidechain/reissue', sidechains.reissue)
    app.express.post('/sidechain/send', sidechains.send)
    app.express.post('/sidechain/balance', sidechains.balance)
    app.express.post('/sidechain/shares', sidechains.shares)
    app.express.post('/sidechain/transactions', sidechains.transactions)
    app.express.post('/sidechain/transaction', sidechains.transaction)
    app.express.post('/sidechain/listunspent', sidechains.listunspent)
    app.express.get('/sidechain/list', sidechains.listchains)
    app.express.post('/sidechain/get', sidechains.getsidechain)
    app.express.post('/sidechain/scan/address', sidechains.scanaddress)
    app.express.post('/sidechain/scan', sidechains.scanchain)
    
    //DAPPS
    app.express.post('/dapps/upload', dapps.upload)

    //IPFS
    app.express.get('/ipfs/info', ipfs.info)
    app.express.post('/ipfs/add', ipfs.add)
    app.express.post('/ipfs/verify/:hash', ipfs.verify)
    app.express.get('/ipfs/type/:hash', ipfs.filetype)
    app.express.get('/ipfs/ls/:hash', ipfs.ls)
    app.express.get('/ipfs/:hash', ipfs.getfile)
    app.express.get('/ipfs/buffer/:hash', ipfs.getfilebuffer)
    app.express.get('/ipfs/:hash/:folder', ipfs.getfolder)
    app.express.get('/ipfs/pins', ipfs.pins)

    //EXPLORER 
    app.express.get('/block/last',explorer.getlastblock)
    app.express.get('/block/:block',explorer.getblock)
    app.express.get('/analyze/:block',explorer.analyzeblock)
    app.express.get('/resync/:block',explorer.resync)
    app.express.get('/transactions/:address', explorer.transactions)
    app.express.get('/balance/:address', explorer.balance)
    app.express.get('/stats/:address', explorer.stats)
    app.express.get('/unspent/:address', explorer.unspent)
  }
}

export default new App().express
