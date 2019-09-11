#!/bin/bash

#INSTALL NODEJS
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install pm2 -g

#DOWNLOADING NODE MODULES
npm install

#STARTING PROCESS
pm2 start npm -- start