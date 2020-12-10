#!/bin/bash

cd docker
docker build -t scrypta:idanode .

if [ -z "$1" ]    
then
    echo "Running Scrypta IdaNode inside Docker, in mainnet mode."
    docker run --restart=unless-stopped -d --name=idanode -dit -p 3001:3001 scrypta:idanode
    docker exec -it -w /opt/ idanode bash bootstrap.sh
else
    echo "Running Scrypta IdaNode inside Docker, in testnet mode."
    docker run --restart=unless-stopped -d --name=idanode -dit -p 3001:3001 scrypta:idanode -testnet
fi