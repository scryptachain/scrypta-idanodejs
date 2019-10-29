#!/bin/bash

#INSTALL WALLET DEPENDENCIES
sudo add-apt-repository -y ppa:bitcoin/bitcoin
sudo apt-get install -y software-properties-common python-software-properties
sudo apt-get update
sudo apt-get install libdb4.8-dev libdb4.8++-dev -y
sudo apt-get -y install build-essential autoconf automake libboost-all-dev libleveldb-dev libgmp-dev libgmp3-dev libssl-dev libcurl4-openssl-dev libcrypto++-dev libqrencode-dev libminiupnpc-dev autogen libtool git libevent-dev libprotobuf-dev
sudo apt-get install -y curl g++ git-core pkg-config libtool faketime bsdmainutils mingw-w64 g++-mingw-w64 nsis zip ca-certificates python
sudo apt-get install -y libzmq3-dev
sudo apt-get install -y libqt5gui5 libqt5core5a libqt5dbus5 qttools5-dev qttools5-dev-tools libprotobuf-dev protobuf-compiler
sudo apt-get install -y libqrencode-dev

#DOWNLOADING WALLET
wget https://github.com/scryptachain/scrypta/releases/download/v1.0.0/lyra-1.0.0-linux-VPS.tar.gz
tar -xvzf lyra-1.0.0-linux-VPS.tar.gz -C ./
mv lyra-1.0.0-linux-VPS/lyrad ./lyrad
mv lyra-1.0.0-linux-VPS/lyra-cli ./lyra-cli
rm -rf lyra-1.0.0-linux-VPS
rm lyra-1.0.0-linux-VPS.tar.gz

#RUNNING WALLET FOR THE FIRST TIME
./lyrad &
sleep 10s
pkill lyrad

#WRITING CONF FILE
echo "rpcuser=lyrarpc
rpcpassword=lyrapassword
rpcallowip=127.0.0.1
listen=1
server=1
daemon=1
index=1
txindex=1
logtimestamps=1" > "/root/.lyra/lyra.conf"

#INSTALL NODEJS
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install pm2 -g

#INSTALL MONGODB
wget -qO - https://www.mongodb.org/static/pgp/server-4.2.asc | sudo apt-key add -
echo "deb [ arch=arm64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.2.list
sudo apt-get update
sudo apt-get install -y mongodb-org
mkdir mongodb_data

#RESTORE MONGODB BOOTSTRAP
wget https://scrypta.sfo2.digitaloceanspaces.com/mongo_bootstrap_191001.tar.gz
mongod --dbpath=./mongodb_data &
sleep 20s
tar -xvzf mongo_bootstrap_191001.tar.gz
sudo mongorestore --db idanodejs --drop idanodejs
rm -rf idanodejs
pkill mongod

#DOWNLOADING NODE MODULES
npm install
cp example.env .env

#UPDATING NPM
npm install -g npm

#SETTING UP NGINX
sudo apt update
sudo apt install nginx -y

#INSTALL CERTBOT
sudo apt install python-certbot-nginx -y

pm2 startup
echo "NOW EDIT .env FILE AND RUN FOLLOWING COMMAND:"
echo "pm2 start npm -- start && pm2 save"