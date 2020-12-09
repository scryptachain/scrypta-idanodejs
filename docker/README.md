Scrypta IdaNode is the application that connects every application to Scrypta Blockchain.

To use it first pull image: 

```
docker pull scrypta/idanode
```

Then run it:
```
docker run -d --name=idanode -dit -p 3001:3001 scrypta/idanode 
```

If you need you can attach the shell and interact with the node directly.

If everything works you will be able to see a public page at `http://localhost:3001` and use all enpoints, as described in our official documentation:
https://en.scrypta.wiki/idanode/