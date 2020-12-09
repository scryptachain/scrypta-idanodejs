#!/bin/bash

cd docker
docker build -t scrypta:idanode .
docker run -d --name=idanode -dit -p 3001:3001 scrypta:idanode
docker exec -it -w /opt/ idanode bash bootstrap.sh