#!/bin/bash

wget https://scrypta.sfo2.digitaloceanspaces.com/idanode_bootstrap.tar.gz
pkill mongod
rm -rf mongodb_data
mkdir mongodb_data
rm -rf idanodejs
tar -xvzf idanode_bootstrap.gz --strip-components 1
sleep 10s
mongod --dbpath=./mongodb_data &
sleep 20s
sudo mongorestore --db idanodejs --drop idanodejs
rm -rf idanodejs
pkill mongod