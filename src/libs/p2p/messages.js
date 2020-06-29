global['relayed'] = {
    messages: {},
    keys: {}
}

global['limits'] = {}

global['broadcasted'] = {
    nodes: [],
    clients: []
}

global['feed'] = {}
require('dotenv').config()
const sign = require('./sign.js')

module.exports = {
    signandbroadcast: async function(protocol, message){
        let signed = await sign.signWithKey(process.env.NODE_KEY, message)
        signed.message = message
        await this.broadcast(protocol, signed)
    },
    broadcast: async function(protocol, message, socketID = '', nodeID = '') {
        //console.log('Broadcasting to network..')
        return new Promise(async response => {
            if(nodeID === ''){
                let sent = 0
                for (let id in global['nodes']) {
                    if(global['connected'][id]){
                        global['nodes'][id].emit(protocol, message)
                        sent ++
                    }
                }
                console.log('Sent message to ' + sent + ' nodes')
            }else{
                if(global['nodes'][nodeID]){
                    global['nodes'][nodeID].emit(protocol, message)
                }
            }
            if(socketID === ''){
                global['io'].server.sockets.emit(protocol, message)
                this.relay(message, protocol)
                console.log('Broadcast to every connected client..')
            }else{
                global['io'].sockets[socketID].emit(protocol, message)
                console.log('Broadcast to client ' + socketID)
            }
            response(message)
        })
    },
    relay: async function(message, protocol = 'message'){
        global['io'].server.sockets.clients((error, clients) => {
            var relay = true
            for(var k in clients){
                var client = clients[k]
                if(!global['relayed']['messages'][client]){
                    global['relayed']['messages'][client] = []
                }
                if(global['limits'][message.address] === undefined){
                    global['limits'][message.address] = new Date().getTime()
                }else{
                    let now = new Date().getTime()
                    let elapsed = now - global['limits'][message.address]
                    if(elapsed < 1000){
                        relay = false
                    }
                }

            
                if(relay === true){
                    console.log('Relaying message to client: ' + client)
                    if(global['relayed']['messages'][client].indexOf(message.signature) === -1){
                        global['limits'][message.address] = new Date().getTime()
                        global['relayed']['messages'][client].push(message.signature)
                        this.broadcast(protocol, message, client)
                    }
                }
            }
        })
    }
};