const { hashElement } = require('folder-hash')
const CryptoJS = require('crypto-js')
const fs = require('fs')
let pkg = require('./package.json')

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
    }
}).catch(error => {
    console.log(error)
})