#!/bin/bash

cd docker
docker build -t scrypta:idanode .
docker run -d --name=idanode -dit -p 3001:3001 scrypta:idanode
sleep 30
docker exec -it idanode lyrad &
docker exec -it -w /opt/scrypta-idanodejs idanode pm2 start dist/index.js