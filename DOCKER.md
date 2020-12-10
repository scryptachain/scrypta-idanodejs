# Use the Idanode with Docker

Assuming you've Docker installed to your system this guide will allow you build the image or download it form Docker HUB.

## Build the image

To build the image you've to simply run our bash script:

```
sudo bash docker.sh
```

If you want to run the IdaNode in *mainnet* mode use the script like this:

```
sudo bash docker.sh -testnet
```

If you want to **force** the building of the image use bash script with `-rebuild` parameter:
```
sudo bash docker.sh -rebuild
sudo bash docker-sh -testnet -rebuild
```

## Using from Docker HUB
To use it first pull image: 

```
docker pull scrypta/idanode
```

If you want to run it in *mainnet* mode you can run it like this:
```
docker run --restart=unless-stopped -d --name=idanode -dit -p 3001:3001 scrypta:idanode
```

If you want to run it in *testnet* mode you can run it like this:
```
docker run --restart=unless-stopped -d --name=idanode_testnet -dit -p 4001:3001 scrypta:idanode -testnet
```

If everything works you will be able to see a public page at `http://localhost:3001` or `http://localhost:4001` in testnet,  and use all enpoints, as described in our official documentation:
https://en.scrypta.wiki/idanode/

If you want to speed up the *mainnet* syncronization process run `bootstrap.sh` script in this way:
```
docker exec -it -w /opt/ idanode bash bootstrap.sh
docker restart idanode
```
