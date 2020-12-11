#!/bin/bash
cd ..
if [[ $1 == "-testnet" ]]
then
    echo "Running Scrypta IdaNode in testnet mode"
    pkill lyrad
    npm run build
    npm run start:testnet
else
    echo "Running Scrypta IdaNode in mainnet mode"
    pkill lyrad
    npm run build
    npm run start
fi