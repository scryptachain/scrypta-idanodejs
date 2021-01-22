#!/bin/bash
sudo apt-get update

sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg-agent \
    software-properties-common

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

cd docker
if [[ "$@" =~ "-rebuild" ]]
then
    echo "Rebuilding Docker Image"
    docker build --no-cache -t scrypta:idanode .
else
    docker build -t scrypta:idanode .
fi

if [[ "$@" =~ "-testnet" ]]
then
    echo "Running Scrypta IdaNode inside Docker, in testnet mode."
    docker run --restart=unless-stopped -d --name=idanode_testnet -dit -p 4001:3001 scrypta:idanode -testnet
    docker exec idanode git checkout .
    docker exec idanode git pull
    docker exec idanode npm run build
    docker restart idanode
else
    echo "Running Scrypta IdaNode inside Docker, in mainnet mode."
    docker run --restart=unless-stopped -d --name=idanode -dit -p 3001:3001 scrypta:idanode
    docker exec -it -w /opt/ idanode bash bootstrap_blockchain.sh
    docker exec -it -w /opt/ idanode bash bootstrap_idanode.sh
    docker exec idanode git checkout .
    docker exec idanode git pull
    docker exec idanode npm run build
    docker restart idanode
fi