import express = require("express")
import * as Crypto from '../libs/Crypto'
import * as Utilities from '../libs/Utilities'

export function watch(req: express.Request, res: express.Response) {
    var address = req.params.address
            
    var wallet = new Crypto.Wallet
    wallet.request('importaddress',[address, address, true]).then(function(response){
        res.json({
            data: 'WATCHING',
            status: 200
        })
    })
};
