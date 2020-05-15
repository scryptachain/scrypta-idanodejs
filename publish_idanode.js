const { hashElement } = require('folder-hash')
const CryptoJS = require('crypto-js')
const fs = require('fs')
let pkg = require('./package.json')
const ScryptaCore = require('@scrypta/core')
const scrypta = new ScryptaCore

let version = pkg.version
const options = {
    folders: { exclude: ['.*', 'node_modules', 'test_coverage'] },
    files: { include: ['*.js', '*.json'] }
}

hashElement('./dist', options).then(hash => {
    let checksum_hash = CryptoJS.SHA256(hash.hash).toString(CryptoJS.enc.Hex)
    const data = fs.readFileSync('checksum', 'utf8')
    let checksums = data.split("\n")
    let found = false
    for(let x in checksums){
        let checksum = checksums[x].split(':')
        if(checksum[0] === version){
            found = true
        }
    }
    if(!found){
        fs.appendFileSync('checksum', "\n" + version + ':' + checksum_hash)
        if(process.env.PUBLISHER_KEY !== undefined){
            let privkey = process.env.PUBLISHER_KEY
            let pubkey = await scrypta.getPublicKey(privkey)
            let address = await scrypta.getAddressFromPubKey(pubkey)
            await scrypta.importPrivateKey(privkey, privkey)
            await app.write(address, privkey, checksum_hash, '', version, '')
            console.log('WRITTEN CHECKSUM ON THE BLOCKCHAIN')
        }
    }
}).catch(error => {
    console.log(error)
})