import * as express from 'express'
import * as wallet from "./routes/Wallet"
import * as explorer from "./routes/Explorer"
import * as manage from "./routes/Manage"

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
    
    app.express.get('/wallet/getinfo',wallet.getinfo)
    app.express.get('/wallet/masternodelist',wallet.getmasternodelist)

    app.express.get('/watch/:address',manage.watch)
    
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
