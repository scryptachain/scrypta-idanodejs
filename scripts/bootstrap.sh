#!/bin/bash

pm2 start npm
sleep 30s
touch .BOOTSTRAPPING
rm idanode_bootstrap.gz
wget https://sfo2.digitaloceanspaces.com/scrypta/idanode_bootstrap.gz
rm -rf idanodejs
tar -xvzf idanode_bootstrap.gz --strip-components 1
sleep 20s
mongorestore --db idanodejs --drop idanodejs
rm .BOOTSTRAPPING
rm -rf idanodejs
rm idanode_bootstrap.gz