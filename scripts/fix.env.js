const fs = require('fs');
const process = require('process');
let key = process.argv.slice(2)
async function run() {
    let update = ""
    if (key[0] !== undefined && key[1] !== undefined) {
        let dotenv = fs.readFileSync('.env').toString('utf8').split("\n")
        for (let k in dotenv) {
            if (dotenv[k].indexOf(key[0]) !== -1) {
                update += key[0] + "=" + key[1]
            } else {
                update += dotenv[k]
            }
            update += "\n"
        }
        fs.writeFileSync('.env', update)
    }
}

run()