"use strict";
import express = require("express")
require('dotenv').config()
const sign = require('../libs/p2p/sign.js')
const utilities = require('../libs/p2p/utilities.js')
const messages = require('../libs/p2p/messages.js')
const request = require('request')
var argv = require('minimist')(process.argv.slice(2))
const app = require('express')()
var server = require('http').Server(app)

global['io'] = { server: null, client: null, sockets: {} }
global['io'].server = require('socket.io')(server)
var dns = require('dns')
const publicIp = require('public-ip');

global['clients'] = {}
global['nodes'] = {}
global['connected'] = {}


export async function initP2P (){
  
  console.log('Starting P2P client.')
  if(process.env.NODE_KEY !== undefined){
    global['identity'] = await sign.returnAddress(process.env.NODE_KEY)

    console.log('Identity loaded: ' + global['identity'])

    let bootstrap = process.env.BOOTSTRAP_NODES.split(',')
    for (var k in bootstrap) {
        if (!global['clients'][bootstrap[k]]) {
            //INIT CONNECTION
            let lookupURL = bootstrap[k].replace('http://', '').replace(':' + process.env.PORT, '')
            let ip = await lookup(lookupURL)
            let publicip = await publicIp.v4().catch(err => {
              console.log('Public IP not available')
            })
            let node = bootstrap[k]

            if (ip !== publicip) {
                console.log('Bootstrap connection to ' + bootstrap[k])
                global['nodes'][node] = require('socket.io-client')(node, { reconnect: true })
                global['nodes'][node].on('connect', function () {
                    console.log('Connected to peer: ' + global['nodes'][node].io.uri)
                    global['connected'][node] = true
                })
                global['nodes'][node].on('disconnect', function () {
                    console.log('Disconnected from peer: ' + global['nodes'][node].io.uri)
                    global['connected'][node] = false
                })

                //PROTOCOLS
                global['nodes'][bootstrap[k]].on('message', async function (data) {
                    let verified = await sign.verifySign(data.pubKey, data.signature, data.message)
                    if(verified === true){
                      console.log('Received message from ' + data.address + '.')
                    }
                })
            }
        }
    }

    //INIT SOCKETIO SERVER
    let p2pport = process.env.PORT;
    console.log('Starting P2P server on port ' + p2pport)
    server.listen(p2pport);
    global['io'].server.on('connection', function (socket) {
        console.log('New peer connected: ' + socket.id)
        global['io'].sockets[socket.id] = socket
        //PROTOCOLS
        socket.on('message', function (data) {
            console.log('Relaying received message to peers.');
            messages.relay(data)
        })

    });
  }else{
    console.log("CAN'T LOAD NODE IDENTITY.")
  }
}

export async function broadcast(req: express.Request, res: express.Response){
  return new Promise(async response => {
    var parsed = await utilities.parse(req)
    var body = parsed.body
    if(body.message !== undefined){
      let signed = await sign.signWithKey(process.env.NODE_KEY, body.message)
      signed.message = body.message
      let broadcasted = await messages.broadcast('message', signed)
      res.json({success: true, broadcasted: broadcasted})
    }else{
      res.json({error: true, message: 'Specify message first.'})
    }
  })
}

async function lookup(lookupURL) {
  return new Promise(response => {
      dns.lookup(lookupURL, async function onLookup(err, ip, family) {
          response(ip)
      })
  })
}
