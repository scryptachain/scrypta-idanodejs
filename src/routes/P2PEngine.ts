"use strict";
import express = require("express")
require('dotenv').config()
const sign = require('../libs/p2p/sign.js')
const utilities = require('../libs/p2p/utilities.js')
const messages = require('../libs/p2p/messages.js')
const app = require('express')()
var server = require('http').Server(app)
let { nextAvailable } = require('node-port-check')
global['io'] = { server: null, client: null, sockets: {} }
var dns = require('dns')
const publicIp = require('public-ip');
const axios = require('axios')
global['clients'] = {}
global['nodes'] = {}
global['connected'] = {}

export async function initP2P() {
  global['io'].server = require('socket.io')(server)
  global['io'].server.set('origins', '*:*')
  console.log('Starting P2P client.')
  
  setTimeout(async function () {
    if (process.env.NODE_KEY !== undefined) {
      global['identity'] = await sign.returnAddress(process.env.NODE_KEY)

      console.log('Identity loaded: ' + global['identity'])
      let nodes = await axios.get('https://raw.githubusercontent.com/scryptachain/scrypta-idanode-network/master/peers')
      let peers = nodes.data.split("\n")
      let bootstrap = []
      for (let x in peers) {
        let peer = peers[x].split(':')
        bootstrap.push('http://' + peer[1])
      }
      for (var k in bootstrap) {
        if (!global['clients'][bootstrap[k]]) {
          //INIT CONNECTION
          let lookupURL = bootstrap[k].replace('http://', '').replace(':' + process.env.P2PPORT, '')
          let ip = await lookup(lookupURL)
          let publicip = await publicIp.v4().catch(err => {
            console.log('Public IP not available')
          })
          let node = bootstrap[k]
          if (ip !== publicip) {
            console.log('Bootstrap connection to ' + bootstrap[k] + ':' + process.env.P2PPORT)
            global['nodes'][node] = require('socket.io-client')(node + ':' + process.env.P2PPORT, { reconnect: true })
            global['nodes'][node].on('event', function (data) { console.log(data) });
            global['nodes'][node].on('connect', function () {
              console.log('Connected to peer: ' + global['nodes'][node].io.uri)
              global['connected'][node] = true
            })
            global['nodes'][node].on('disconnect', function () {
              console.log('Disconnected from peer: ' + global['nodes'][node].io.uri)
              global['connected'][node] = false
            })

            /*global['nodes'][bootstrap[k]].on('planum-unspent', async function (data) {
              let pubkey
              if (data.pubKey !== undefined) {
                pubkey = data.pubKey
              } else if (data.pubkey !== undefined) {
                pubkey = data.pubkey
              }
              let verified = await sign.verifySign(pubkey, data.signature, data.message)
              if (verified === true) {
                if (global['sxidcache'].indexOf(data.message) === -1) {
                  global['sxidcache'].push(data.message)
                }
                console.log('Received used unspent ' + data.message)
              }
            })*/
          }
        }
      }

      //INIT SOCKETIO SERVER
      let port = await nextAvailable(process.env.P2PPORT, '0.0.0.0')
      try {
        server.listen(port);
        if (global['io'].server !== null) {
          console.log('Starting P2P server on port ' + port)
          global['io'].server.on('connection', function (socket) {
            console.log('New peer connected: ' + socket.id)
            global['io'].sockets[socket.id] = socket

            //PROTOCOLS
            socket.on('message', function (data) {
              messages.relay(data, 'message')
            })

            socket.on('planum-unspent', function (data) {
              messages.relay(data, 'planum-unspent')
            })
          });
        }
      } catch (e) {
        console.log('ERROR WHILE STARTING P2P SERVER')
      }
    } else {
      console.log("CAN'T LOAD NODE IDENTITY.")
    }
  }, 500)
}

export async function broadcast(req: express.Request, res: express.Response) {
  return new Promise(async response => {
    var parsed = await utilities.parse(req)
    var body = parsed.body
    if (body.message !== undefined) {
      let message = JSON.stringify(new Date().getTime())
      let signed = await sign.signWithKey(process.env.NODE_KEY, message)
      signed.message = message
      let broadcasted = await messages.broadcast('message', signed)
      res.json({ success: true, broadcasted: broadcasted })
    } else {
      res.json({ error: true, message: 'Specify message first.' })
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
