import * as express from 'express'
import * as wallet from "./routes/Wallet"
import * as explorer from "./routes/Explorer"
import * as pdm from "./routes/Pdm"

var bodyParser = require('body-parser')
var cors = require('cors')

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

    //ADDRESSES
    app.express.post('/init',wallet.init)
    app.express.post('/send',wallet.send)
    app.express.post('/sendrawtransaction', wallet.sendrawtransaction)

    //WALLET
    app.express.get('/wallet/getinfo',wallet.getinfo)
    app.express.get('/wallet/masternodelist',wallet.getmasternodelist)

    //PROGRESSIVE DATA MANAGEMENT
    app.express.post('/write', pdm.write)
    app.express.post('/read', pdm.read)
    app.express.post('/invalidate', pdm.invalidate)
    app.express.post('/received', pdm.received)

    //EXPLORER
    app.express.get('/',explorer.info)
    app.express.get('/block/:block',explorer.getblock)
    app.express.get('/transaction/:txid', explorer.gettransaction)
    app.express.get('/transactions/:address', explorer.transactions)
    app.express.get('/balance/:address', explorer.balance)
    app.express.get('/stats/:address', explorer.stats)
    app.express.get('/unspent/:address', explorer.unspent)
  }
}

export default new App().express
