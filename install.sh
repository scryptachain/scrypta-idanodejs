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
rm lyra-1.0.0-linux-VPS.tar.gz

#RUNNING WALLET FOR THE FIRST TIME
./lyrad &
sleep 5s
pkill lyrad

#WRITING CONF FILE
echo "RPCUSER=lyrarpc\nRPCPASSWORD=lyrapasswordrpcallowip=127.0.0.1\nlisten=1\nserver=1\ndaemon=1\nindex=1\ntxindex=1\nlogtimestamps=1" > "~/.lyra/lyra.conf"
./lyrad &

#INSTALL NODEJS
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install pm2 -g

#DOWNLOADING NODE MODULES
npm install
cp example.env .env

echo "NOW EDIT .env FILE AND RUN pm2 start npm -- start"