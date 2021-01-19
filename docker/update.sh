#!/bin/bash

docker exec idanode git checkout .
docker exec idanode git pull
docker exec idanode npm run build
docker restart idanode