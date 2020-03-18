var CoinKey = require('coinkey')
const CryptoJS = require('crypto-js')
const secp256k1 = require('secp256k1')

const lyraInfo = {
    private: 0xae,
    public: 0x30,
    scripthash: 0x0d
};

module.exports = {
    signWithKey: async function(key, message){
        return new Promise(response => {
            //CREATING CK OBJECT
            var ck = CoinKey.fromWif(key, lyraInfo);
            //CREATE HASH FROM MESSAGE
            let hash = CryptoJS.SHA256(message);
            let msg = Buffer.from(hash.toString(CryptoJS.enc.Hex), 'hex');
            //GETTING PUBKEY FROM PRIVATEKEY
            let privKey = ck.privateKey
            //SIGNING MESSAGE
            const sigObj = secp256k1.sign(msg, privKey)
            const pubKey = secp256k1.publicKeyCreate(privKey)

            response({
                signature: sigObj.signature.toString('hex'),
                pubKey: pubKey.toString('hex'),
                address: ck.publicAddress
            })
        })
    },
    returnPubKey: async function(key){
        return new Promise(response => {
            //CREATING CK OBJECT
            var ck = CoinKey.fromWif(key, lyraInfo);
            //GETTING PUBKEY FROM PRIVATEKEY
            let privKey = ck.privateKey
            const pubKey = secp256k1.publicKeyCreate(privKey)
            response(pubKey)
        })
    },
    returnAddress: async function(key){
        return new Promise(response => {
            //CREATING CK OBJECT
            var ck = CoinKey.fromWif(key, lyraInfo);
            //GETTING ADDRESS
            response(ck.publicAddress)
        })
    },
    verifySign: async function(keyhex, sighex, message){
        return new Promise(response => {
            //CREATE HASH FROM MESSAGE
            let hash = CryptoJS.SHA256(message);
            let msg = Buffer.from(hash.toString(CryptoJS.enc.Hex), 'hex')
            //VERIFY MESSAGE
            let signature = Buffer.from(sighex,'hex')
            let pubKey = Buffer.from(keyhex,'hex')
            verified = secp256k1.verify(msg, signature, pubKey)
            response(verified)
        })
    }
};