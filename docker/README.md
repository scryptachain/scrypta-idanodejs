Scrypta IdaNode is the application that connects every application to Scrypta Blockchain.

To use it first pull image: 

```
docker pull scrypta/idanode
```

Then run it:
```
docker run -d --name=idanode -dit -p 3001:3001 scrypta/idanode 
```

When container is ready please run the application with:
```
docker exec -it idanode lyrad &
docker exec -it -w /opt/scrypta-idanodejs idanode pm2 start dist/index.js
```

If everything works you will be able to see a public page at `http://localhost:3001` and use all enpoints, as described in our official documentation:
https://en.scrypta.wiki/idanode/