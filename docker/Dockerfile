FROM mongo:bionic
RUN apt-get -qq update
RUN apt-get install -y software-properties-common 
RUN apt-get install -y git git-core curl wget nano zip

#WRITING CONF FILE
RUN mkdir /root/.lyra
RUN echo "rpcuser=astrongrpcuser \
rpcpassword=astrongrpcpassword \
rpcallowip=127.0.0.1 \
listen=1 \
server=1 \
daemon=1 \
index=1 \
txindex=1 \
logtimestamps=1" > "/root/.lyra/lyra.conf"

# CLONING REPO
WORKDIR /opt
RUN git clone https://github.com/scryptachain/scrypta-idanodejs
WORKDIR /opt/scrypta-idanodejs
RUN cp example.env .env

#INSTALL NODEJS
RUN curl -q https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get update
RUN apt-get install -y nodejs
RUN npm install pm2 -g

# UPDATING NPM
RUN npm install -g npm
RUN pm2 install pm2-logrotate
RUN pm2 set pm2-logrotate:max_size 100M
RUN pm2 set pm2-logrotate:compress true
RUN pm2 set pm2-logrotate:rotateInterval '0 * * * *'

# SETTING UP MONGODB
RUN mkdir -p mongodb_data configdb \
	&& chown -R mongodb:mongodb mongodb_data configdb
RUN ulimit -n 640000

# BUILDING IDANODE
RUN apt-get install -y make build-essential
RUN npm install
RUN npm run build

# RUNNING NODE
RUN pm2 start dist/index.js

EXPOSE 3001
CMD tail -f /dev/null