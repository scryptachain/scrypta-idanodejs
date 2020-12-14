#!/bin/bash

touch .BOOTSTRAPPING
rm idanode_bootstrap.gz
wget https://sfo2.digitaloceanspaces.com/scrypta/idanode_bootstrap.gz
rm -rf data
mkdir data
rm -rf idanodejs
tar -xvzf idanode_bootstrap.gz --strip-components 1
sleep 20s
sudo mongorestore --db idanodejs --drop idanodejs
rm .BOOTSTRAPPING
rm -rf idanodejs
rm idanode_bootstrap.gz