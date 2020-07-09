require ('./jsbn.js')
require ('./ellipticcurve.js')
require ('./ripemd160.js')
require ('./crypto-sha256-hmac.js')

var B58 = {
	alphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
	validRegex: /^[1-9A-HJ-NP-Za-km-z]+$/,
	base: BigInteger.valueOf(58),
	encode: function (input) {
		var bi = BigInteger.fromByteArrayUnsigned(input);
		var chars = [];

		while (bi.compareTo(B58.base) >= 0) {
			var mod = bi.mod(B58.base);
			chars.unshift(B58.alphabet[mod.intValue()]);
			bi = bi.subtract(mod).divide(B58.base);
		}
		chars.unshift(B58.alphabet[bi.intValue()]);

		// Convert leading zeros too.
		for (var i = 0; i < input.length; i++) {
			if (input[i] == 0x00) {
				chars.unshift(B58.alphabet[0]);
			} else break;
		}

		return chars.join('');
	},
	decode: function (input) {
		var bi = BigInteger.valueOf(0);
		var leadingZerosNum = 0;
		for (var i = input.length - 1; i >= 0; i--) {
			var alphaIndex = B58.alphabet.indexOf(input[i]);
			if (alphaIndex < 0) {
				throw "Invalid character";
			}
			bi = bi.add(BigInteger.valueOf(alphaIndex)
							.multiply(B58.base.pow(input.length - 1 - i)));

			// This counts leading zero bytes
			if (input[i] == "1") leadingZerosNum++;
			else leadingZerosNum = 0;
		}
		var bytes = bi.toByteArrayUnsigned();

		// Add leading zeros
		while (leadingZerosNum-- > 0) bytes.unshift(0);

		return bytes;
	}
}

export default class BitJS {

	constructor (){
		/* public vars */
		this.priv = 0xae;
		this.compressed = true;
	}

	static hexToBytes(b){for(var a=[],c=0;c<b.length;c+=2)a.push(parseInt(b.substr(c,2),16));return a}
	static bytesToHex(b){for(var a=[],c=0;c<b.length;c++)a.push((b[c]>>>4).toString(16)),a.push((b[c]&15).toString(16));return a.join("")}

	static privkey2wif(h){
		var r = BitJS.hexToBytes(h);

		if(this.compressed==true){
			r.push(0x0d);
		}

		r.unshift(this.priv);
		var hash = Crypto.SHA256(Crypto.SHA256(r, {asBytes: true}), {asBytes: true});
		var checksum = hash.slice(0, 4);

		return B58.encode(r.concat(checksum));
	}

	/* convert a wif key back to a private key */
	static wif2privkey (wif){
		var compressed = false;
		var decode = B58.decode(wif);
		var key = decode.slice(0, decode.length-4);
		key = key.slice(1, key.length);
		if(key.length>=33 && key[key.length-1]==0x01){
			key = key.slice(0, key.length-1);
			compressed = true;
		}
		return {'privkey': BitJS.bytesToHex(key), 'compressed':compressed};
	}

	/* convert a wif to a pubkey */
	static wif2pubkey(wif){
		var compressed = this.compressed;
		var r = BitJS.wif2privkey(wif);
		this.compressed = r['compressed'];
		var pubkey = this.newPubkey(r['privkey']);
		this.compressed = compressed;
		return {'pubkey':pubkey,'compressed':r['compressed']};
	}

	/* generate a public key from a private key */
	static newPubkey(hash){
		var privateKeyBigInt = BigInteger.fromByteArrayUnsigned(BitJS.hexToBytes(hash));
		var curve = EllipticCurve.getSECCurveByName("secp256k1");

		var curvePt = curve.getG().multiply(privateKeyBigInt);
		var x = curvePt.getX().toBigInteger();
		var y = curvePt.getY().toBigInteger();

		var publicKeyBytes = EllipticCurve.integerToBytes(x, 32);
		publicKeyBytes = publicKeyBytes.concat(EllipticCurve.integerToBytes(y,32));
		publicKeyBytes.unshift(0x04);

		if(this.compressed==true){
			var publicKeyBytesCompressed = EllipticCurve.integerToBytes(x,32)
			if (y.isEven()){
				publicKeyBytesCompressed.unshift(0x02)
			} else {
				publicKeyBytesCompressed.unshift(0x03)
			}
			return BitJS.bytesToHex(publicKeyBytesCompressed);
		} else {
			return BitJS.bytesToHex(publicKeyBytes);
		}
	}

	static transaction() {
		var btrx = {};
		btrx.version = 1;
		btrx.inputs = [];
		btrx.outputs = [];
		btrx.locktime = 0;

		btrx.addinput = function(txid, index, script, sequence) {
			var o = {};
			o.outpoint = {'hash': txid, 'index': index};
			//o.script = []; Signature and Public Key should be added after singning
			o.script = BitJS.hexToBytes(script); //push previous output pubkey script
			o.sequence = sequence || ((btrx.locktime==0) ? 4294967295 : 0);
			return this.inputs.push(o);
		}

		btrx.addoutput = function(address, value) {
			var o = {};
			var buf = [];
			var addrDecoded = btrx.addressDecode(address)
			o.value = new BigInteger('' + Math.round((value*1) * 1e8), 10);
			buf.push(118); //OP_DUP
			buf.push(169);  //OP_HASH160
			buf.push(addrDecoded.length);
			buf = buf.concat(addrDecoded); // address in bytes
			buf.push(136); //OP_EQUALVERIFY
			buf.push(172); //  OP_CHECKSIG
			o.script = buf;
			return this.outputs.push(o);
		}

		btrx.addmetadata = function(data) {
			var o = {};
			var buf = [];
			o.value = 0;
			var bytes = Buffer.from(data)
			buf.push(BitJS.hexToBytes('6a')[0]);

			if(data.length > 75 && data.length <= 255){
				// PUSHING OP_PUSHDATA TO THE STACK
				buf.push(BitJS.hexToBytes('4c')[0]);
				var ln = BitJS.numToByteArray(data.length)
				buf.push(ln[0]);
			}else if(data.length > 255){
				// PUSHING OP_PUSHDATA2 TO THE STACK
				buf.push(BitJS.hexToBytes('4d')[0]);
				var ln = BitJS.numToByteArray(data.length)
				buf.push(ln[0])
				buf.push(ln[1])
			}else if(data.length < 75){
				var ln = BitJS.numToByteArray(data.length)
				buf.push(ln[0]);
			}

			for(var i=0; i<bytes.length; i++){
				if(bytes[i] !== undefined){
					buf.push(bytes[i]);
				}
			}
			o.script = buf;
			return this.outputs.push(o);
		}

		// Only standard addresses
		btrx.addressDecode = function(address) {
			var bytes = B58.decode(address);
			var front = bytes.slice(0, bytes.length-4);
			var back = bytes.slice(bytes.length-4);
			return front.slice(1);
		}

		/* generate the transaction hash to sign from a transaction input */
		btrx.transactionHash = function(index, sigHashType) {

			var clone = BitJS.clone(this);
			var shType = sigHashType || 1;

			/* black out all other ins, except this one */
			for (var i = 0; i < clone.inputs.length; i++) {
				if(index!=i){
					clone.inputs[i].script = [];
				}
			}


			if((clone.inputs) && clone.inputs[index]){

				/* SIGHASH : For more info on sig hashs see https://en.bitcoin.it/wiki/OP_CHECKSIG
					and https://bitcoin.org/en/developer-guide#signature-hash-type */

				if(shType == 1){
					//SIGHASH_ALL 0x01

				} else if(shType == 2){
					//SIGHASH_NONE 0x02
					clone.outputs = [];
					for (var i = 0; i < clone.inputs.length; i++) {
						if(index!=i){
							clone.inputs[i].sequence = 0;
						}
					}

				} else if(shType == 3){

					//SIGHASH_SINGLE 0x03
					clone.outputs.length = index + 1;

					for(var i = 0; i < index; i++){
						clone.outputs[i].value = -1;
						clone.outputs[i].script = [];
					}

					for (var i = 0; i < clone.inputs.length; i++) {
						if(index!=i){
							clone.inputs[i].sequence = 0;
						}
					}

				} else if (shType >= 128){
					//SIGHASH_ANYONECANPAY 0x80
					clone.inputs = [clone.inputs[index]];

					if(shType==129){
						// SIGHASH_ALL + SIGHASH_ANYONECANPAY

					} else if(shType==130){
						// SIGHASH_NONE + SIGHASH_ANYONECANPAY
						clone.outputs = [];

					} else if(shType==131){
												// SIGHASH_SINGLE + SIGHASH_ANYONECANPAY
						clone.outputs.length = index + 1;
						for(var i = 0; i < index; i++){
							clone.outputs[i].value = -1;
							clone.outputs[i].script = [];
						}
					}
				}

				var buffer = BitJS.hexToBytes(clone.serialize());
				buffer = buffer.concat(BitJS.numToBytes(parseInt(shType), 4));
				var hash = Crypto.SHA256(buffer, {asBytes: true});
				var r = BitJS.bytesToHex(Crypto.SHA256(hash, {asBytes: true}));
				return r;
			} else {
				return false;
			}
		}

		/* generate a signature from a transaction hash */
		btrx.transactionSig = function(index, wif, sigHashType, txhash){

			function serializeSig(r, s) {
				var rBa = r.toByteArraySigned();
				var sBa = s.toByteArraySigned();

				var sequence = [];
				sequence.push(0x02); // INTEGER
				sequence.push(rBa.length);
				sequence = sequence.concat(rBa);

				sequence.push(0x02); // INTEGER
				sequence.push(sBa.length);
				sequence = sequence.concat(sBa);

				sequence.unshift(sequence.length);
				sequence.unshift(0x30); // SEQUENCE

				return sequence;
			}

			var shType = sigHashType || 1;
			var hash = txhash || BitJS.hexToBytes(this.transactionHash(index, shType));

			if(hash){
				var curve = EllipticCurve.getSECCurveByName("secp256k1");
				var key = BitJS.wif2privkey(wif);
				var priv = BigInteger.fromByteArrayUnsigned(BitJS.hexToBytes(key['privkey']));
				var n = curve.getN();
				var e = BigInteger.fromByteArrayUnsigned(hash);
				var badrs = 0
				do {
					var k = this.deterministicK(wif, hash, badrs);
					var G = curve.getG();
					var Q = G.multiply(k);
					var r = Q.getX().toBigInteger().mod(n);
					var s = k.modInverse(n).multiply(e.add(priv.multiply(r))).mod(n);
					badrs++
				} while (r.compareTo(BigInteger.ZERO) <= 0 || s.compareTo(BigInteger.ZERO) <= 0);

				// Force lower s values per BIP62
				var halfn = n.shiftRight(1);
				if (s.compareTo(halfn) > 0) {
					s = n.subtract(s);
				};

				var sig = serializeSig(r, s);
				sig.push(parseInt(shType, 10));

				return BitJS.bytesToHex(sig);
			} else {
				return false;
			}
		}

		// https://tools.ietf.org/html/rfc6979#section-3.2
		btrx.deterministicK = function(wif, hash, badrs) {
			// if r or s were invalid when this function was used in signing,
			// we do not want to actually compute r, s here for efficiency, so,
			// we can increment badrs. explained at end of RFC 6979 section 3.2

			// wif is b58check encoded wif privkey.
			// hash is byte array of transaction digest.
			// badrs is used only if the k resulted in bad r or s.

			// some necessary things out of the way for clarity.
			badrs = badrs || 0;
			var key = BitJS.wif2privkey(wif);
			var x = BitJS.hexToBytes(key['privkey'])
			var curve = EllipticCurve.getSECCurveByName("secp256k1");
			var N = curve.getN();

			// Step: a
			// hash is a byteArray of the message digest. so h1 == hash in our case

			// Step: b
			var v = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

			// Step: c
			var k = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

			// Step: d
			k = Crypto.HMAC(Crypto.SHA256, v.concat([0]).concat(x).concat(hash), k, { asBytes: true });

			// Step: e
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });

			// Step: f
			k = Crypto.HMAC(Crypto.SHA256, v.concat([1]).concat(x).concat(hash), k, { asBytes: true });

			// Step: g
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });

			// Step: h1
			var T = [];

			// Step: h2 (since we know tlen = qlen, just copy v to T.)
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
			T = v;

			// Step: h3
			var KBigInt = BigInteger.fromByteArrayUnsigned(T);

			// loop if KBigInt is not in the range of [1, N-1] or if badrs needs incrementing.
			var i = 0
			while (KBigInt.compareTo(N) >= 0 || KBigInt.compareTo(BigInteger.ZERO) <= 0 || i < badrs) {
				k = Crypto.HMAC(Crypto.SHA256, v.concat([0]), k, { asBytes: true });
				v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
				v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
				T = v;
				KBigInt = BigInteger.fromByteArrayUnsigned(T);
				i++
			};

			return KBigInt;
		};

    	/* sign a "standard" input */
		btrx.signinput = function(index, wif, sigHashType){
			var key = BitJS.wif2pubkey(wif);
			var shType = sigHashType || 1;
			var signature = this.transactionSig(index, wif, shType);
			var buf = [];
			var sigBytes = BitJS.hexToBytes(signature);
			buf.push(sigBytes.length);
			buf = buf.concat(sigBytes);
	    	var pubKeyBytes = BitJS.hexToBytes(key['pubkey']);
			buf.push(pubKeyBytes.length);
			buf = buf.concat(pubKeyBytes);
			this.inputs[index].script = buf;
			return true;
		}

		/* sign inputs */
		btrx.sign = function(wif, sigHashType) {
			var shType = sigHashType || 1;
			for (var i = 0; i < this.inputs.length; i++) {
				this.signinput(i, wif, shType);
			}
			return this.serialize();
		}


		/* serialize a transaction */
		btrx.serialize = function() {
			var buffer = [];
			buffer = buffer.concat(BitJS.numToBytes(parseInt(this.version),4));

			buffer = buffer.concat(BitJS.numToVarInt(this.inputs.length));
			for (var i = 0; i < this.inputs.length; i++) {
				var txin = this.inputs[i];
				buffer = buffer.concat(BitJS.hexToBytes(txin.outpoint.hash).reverse());
				buffer = buffer.concat(BitJS.numToBytes(parseInt(txin.outpoint.index),4));
				var scriptBytes = txin.script;
				buffer = buffer.concat(BitJS.numToVarInt(scriptBytes.length));
				buffer = buffer.concat(scriptBytes);
				buffer = buffer.concat(BitJS.numToBytes(parseInt(txin.sequence),4));
			}
			buffer = buffer.concat(BitJS.numToVarInt(this.outputs.length));

			for (var i = 0; i < this.outputs.length; i++) {
				var txout = this.outputs[i];
				buffer = buffer.concat(BitJS.numToBytes(txout.value,8));
				var scriptBytes = txout.script;
				buffer = buffer.concat(BitJS.numToVarInt(scriptBytes.length));
				buffer = buffer.concat(scriptBytes);
			}

			buffer = buffer.concat(BitJS.numToBytes(parseInt(this.locktime),4));
			return BitJS.bytesToHex(buffer);
		}


		return btrx;

	}

	static numToBytes(num,bytes) {
		if (typeof bytes === "undefined") bytes = 8;
		if (bytes == 0) {
			return [];
		} else if (num == -1){
			return BitJS.hexToBytes("ffffffffffffffff");
		} else {
			return [num % 256].concat(BitJS.numToBytes(Math.floor(num / 256),bytes-1));
		}
	}

	static numToByteArray(num) {
		if (num < 256) {
			return [num];
		} else {
			return [num % 256].concat(this.numToByteArray(Math.floor(num / 256)));
		}
	}

	static numToVarInt(num) {
		if (num < 253) {
			return [num];
		} else if (num < 65536) {
			return [253].concat(BitJS.numToBytes(num,2));
		} else if (num < 4294967296) {
			return [254].concat(BitJS.numToBytes(num,4));
		} else {
			return [255].concat(BitJS.numToBytes(num,8));
		}
	}

	static bytesToNum(bytes) {
		if (bytes.length == 0) return 0;
		else return bytes[0] + 256 * this.bytesToNum(bytes.slice(1));
	}

	/* clone an object */
	static clone(obj) {
		if(obj == null || typeof(obj) != 'object') return obj;
		var temp = new obj.constructor();

		for(var key in obj) {
			if(obj.hasOwnProperty(key)) {
				temp[key] = BitJS.clone(obj[key]);
			}
		}
		return temp;
	}


}
