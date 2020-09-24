#!/bin/bash

// wget https://sfo2.digitaloceanspaces.com/scrypta/idanode_bootstrap.gz
killall mongod
rm -rf mongodb_data
mkdir mongodb_data
rm -rf idanodejs
tar -xvzf idanode_bootstrap.gz --strip-components 1
sleep 20s
mongod --dbpath=./mongodb_data &
sleep 20s
sudo mongorestore --db idanodejs --drop idanodejs
rm -rf idanodejs
// rm idanode_bootstrap.gz
killall mongod