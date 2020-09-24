"use strict";
const mongo = require('mongodb').MongoClient
import * as Crypto from '../libs/Crypto'
const LZUTF8 = require('lzutf8')

module Contracts {

    export class Local {

        public async pinned() {
            return new Promise<any>(async response => {
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    const db = client.db(global['db_name'])
                    let wallet = new Crypto.Wallet
                    let adminpubkey = await wallet.getPublicKey(process.env.NODE_KEY)
                    let adminaddress = await wallet.getAddressFromPubKey(adminpubkey)
                    let pinned = await db.collection('written').find({ protocol: 'pin://', address: adminaddress }).sort({ block: -1 }).toArray()
                    let unique = []
                    let res = []
                    for (let k in pinned) {
                        let unpinned = await db.collection('written').find({ protocol: 'unpin://', address: adminaddress, data: pinned[k].data }).sort({ block: -1 }).toArray()
                        let isUnpinned = false
                        if(unpinned.length > 0){
                            if(unpinned[0].block >= pinned[k].block){
                                isUnpinned = true
                            }
                        }
                        if (isUnpinned === false) {
                            let contract = ''
                            let version = ''
                            if (pinned[k].data.indexOf(':') !== -1) {
                                let expcontract = pinned[k].data.split(':')
                                contract = expcontract[0]
                                version = expcontract[1]
                            } else {
                                contract = pinned[k].data
                                version = 'latest'
                            }
                            if (unique.indexOf(contract) === -1) {
                                unique.push(contract)
                                res.push({contract: pinned[k].data, version: version})
                            }
                        }
                    }
                    client.close()
                    response(res)
                })
            });
        }

        public async all() {
            return new Promise<any>(async response => {
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    const db = client.db(global['db_name'])
                    let res = await db.collection('written').find({ protocol: 'ida://' }).sort({ block: -1 }).toArray()
                    client.close()
                    let contracts = []
                    let unique = []
                    const wallet = new Crypto.Wallet
                    for (let k in res) {
                        if (unique.indexOf(res[k].address) === -1) {
                            unique.push(res[k].address)
                            let verify = await wallet.verifymessage(res[k].data.pubkey, res[k].data.signature, res[k].data.message)
                            if (verify !== false) {
                                try {
                                    let contract = JSON.parse(res[k].data.message)
                                    contract.code = LZUTF8.decompress(contract.code, { inputEncoding: "Base64" })
                                    contracts.push(contract)
                                } catch (e) {
                                    console.log('ERROR ON CONTRACT')
                                }
                            }
                        }
                    }
                    response(contracts)
                })
            });
        }

        public async find(contract, version) {
            return new Promise<any>(async response => {
                mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
                    const db = client.db(global['db_name'])
                    let found
                    if(version === 'latest'){
                        let res = await db.collection('written').find({ protocol: 'ida://', address: contract }).sort({ block: -1 }).limit(1).toArray()
                        found = res[0]
                        client.close()
                    }else{
                        let res = await db.collection('written').find({ protocol: 'ida://', address: contract, refID: version }).sort({ block: -1 }).limit(1).toArray()
                        found = res[0]
                        client.close()
                    }
                    response(found)
                })
            });
        }

    }

}

export = Contracts;
