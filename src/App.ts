import * as express from 'express'
import * as wallet from "./routes/Wallet"
import * as explorer from "./routes/Explorer"
import * as ipfs from "./routes/Ipfs"
import * as trustlink from "./routes/Trustlink"
import * as pdm from "./routes/Pdm"
import * as dapps from "./routes/dApps"

var bodyParser = require('body-parser')
var cors = require('cors')
const IPFS = require('ipfs')
global['ipfs'] = new IPFS({ repo: 'ipfs_data' })
global['txidcache'] = []
global['utxocache'] = []

//TODO: Implement a cache system so data can be parsed through different blocks
global['writtencache'] = [] 

class App {
  public express
  public db
  public Wallet

  constructor () {
    const app = this
    app.express = express()

    app.express.use(bodyParser.json())
    app.express.use(bodyParser.urlencoded({extended: true}))
    app.express.use(express.static('public'))
    app.express.use(cors())
    app.express.options('*', cors())

    //ADDRESSES
    app.express.post('/init',wallet.init)
    app.express.post('/send',wallet.send)
    app.express.post('/sendrawtransaction', wallet.sendrawtransaction)
    app.express.post('/decoderawtransaction', wallet.decoderawtransaction)

    //WALLET
    app.express.get('/wallet/getinfo',wallet.getinfo)
    app.express.get('/wallet/masternodelist',wallet.getmasternodelist)

    //PROGRESSIVE DATA MANAGEMENT
    app.express.post('/write', pdm.write)
    app.express.post('/read', pdm.read)
    app.express.post('/invalidate', pdm.invalidate)
    app.express.post('/received', pdm.received)

    //TRUSTLINK
    app.express.post('/trustlink/init', trustlink.init)

    //DAPPS
    app.express.post('/dapps/upload', dapps.upload)

    //IPFS
    app.express.get('/ipfs/info', ipfs.info)
    app.express.post('/ipfs/add', ipfs.add)
    app.express.post('/ipfs/verify/:hash', ipfs.verify)
    app.express.get('/ipfs/type/:hash', ipfs.filetype)
    app.express.get('/ipfs/ls/:hash', ipfs.ls)
    app.express.get('/ipfs/pins', ipfs.pins)
    app.express.get('/ipfs/:hash/:folder', ipfs.getfolder)
    app.express.get('/ipfs/:hash', ipfs.getfile)

    //EXPLORER
    app.express.get('/',explorer.info)
    app.express.get('/lastblock',explorer.getlastblock)
    app.express.get('/block/:block',explorer.getblock)
    app.express.get('/transactions/:address', explorer.transactions)
    app.express.get('/balance/:address', explorer.balance)
    app.express.get('/stats/:address', explorer.stats)
    app.express.get('/unspent/:address', explorer.unspent)
  }
}

export default new App().express
