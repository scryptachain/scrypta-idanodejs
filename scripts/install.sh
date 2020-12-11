#!/bin/bash

#DOWNLOADING WALLET
https://github.com/scryptachain/scrypta/releases/download/2.0.1/lyra-2.0.1-linux-server.zip
unzip lyra-2.0.1-linux-server.zip
mv lyrad /usr/bin/lyrad
mv lyra-cli /usr/bin/lyra-cli
rm -rf bin
rm lyra-2.0.1-linux-server.zip

#RUNNING WALLET FOR THE FIRST TIME
lyrad &
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
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install pm2 -g

#INSTALL MONGODB
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
sudo apt-get update
sudo apt-get install -y mongodb-org
mkdir data
ulimit -n 640000

#DOWNLOADING NODE MODULES
npm install
cp example.env .env
npm run build

#UPDATING NPM
npm install -g npm
npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 * * * *'

#SETTING UP FIREWALL
ufw allow 22
ufw deny 42223
ufw deny 27017
ufw allow 42222
ufw enable y

#SETTING UP NGINX
sudo apt update
sudo apt install nginx -y
sudo ufw allow 'Nginx Full'

#INSTALL CERTBOT
sudo add-apt-repository ppa:certbot/certbot -y
sudo apt update
sudo apt install python-certbot-nginx -y

pm2 startup
echo "NOW EDIT .env FILE AND RUN FOLLOWING COMMAND:"
echo "pm2 start npm -- start && pm2 save"
