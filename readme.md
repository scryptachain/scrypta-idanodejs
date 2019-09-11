## Scrypta IdaNodes implementation in TypeScript
<br>
<a href="http://tiny.cc/devbounty"><img src="https://i.imgur.com/Yf2iz8w.png" title="source: imgur.com" /></a>


Start the IdaNode requires a working Scrypta Wallet and NodeJS. 
You can install both by running the `install.sh` file.


**If you're installing it in a server or VPS please use Ubuntu 16.04 distro.**

Please attention, minimum requirements for lyra.conf are
```
rpcuser=astronguserpleasedonotusethis

rpcpassword=astrongpasswordpleasedonotusethis

rpcallowip=127.0.0.1

listen=1

server=1

daemon=1

index=1

txindex=1

logtimestamps=1
```

After you've installed all dependencies please write your own `.env` file by copying the example with
`cp example.env .env`
and edit your informations regarding the position of the wallet and the RPC user/password.


You can run the IdaNode in development mode with `npm run dev` or simply run it with `npm start`
