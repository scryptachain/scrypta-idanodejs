#!/bin/bash

cd docker
docker build -t scrypta:idanode .
docker run -d --name -p 3001 multi scrypta:idanode