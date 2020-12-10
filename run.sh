#!/bin/bash

pkill lyrad
npm run build

if [ -z "$1" ]    
then
    echo "Running Scrypta IdaNode in mainnet mode"
    pm2 start npm -- start
else
    echo "Running Scrypta IdaNode in testnet mode"
    pm2 start npm -- run start:testnet
fi