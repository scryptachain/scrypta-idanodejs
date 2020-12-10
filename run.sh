#!/bin/bash

pkill lyrad
npm run build

if [ -z "$1" ]    
then
    echo "Running Scrypta IdaNode in mainnet mode"
    npm run start
else
    echo "Running Scrypta IdaNode in testnet mode"
    npm run start:testnet
fi