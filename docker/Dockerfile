FROM mongo:bionic
RUN apt-get -qq update
RUN apt-get install -y software-properties-common 
RUN apt-get install -y git git-core curl wget nano zip

#WRITING CONF FILE
RUN mkdir /root/.lyra

# CLONING REPO
WORKDIR /opt
RUN git clone https://github.com/scryptachain/scrypta-idanodejs
WORKDIR /opt/scrypta-idanodejs
RUN node create_conf.js

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
RUN pm2 startup

# SETTING UP MONGODB
RUN mkdir -p mongodb_data configdb \
	&& chown -R mongodb:mongodb mongodb_data configdb
RUN ulimit -n 640000

# BUILDING IDANODE
RUN apt-get install -y make build-essential
RUN npm install
RUN npm run build

#DOWNLOADING WALLET
RUN wget https://github.com/scryptachain/scrypta/releases/download/2.0.1/lyra-2.0.1-linux-server.zip
RUN unzip lyra-2.0.1-linux-server.zip
RUN mv lyrad /usr/bin/lyrad
RUN mv lyra-cli /usr/bin/lyra-cli
RUN rm -rf bin
RUN rm lyra-2.0.1-linux-server.zip


# DOWNLOADING BOOTSTRAPS
WORKDIR /opt/scrypta-idanodejs
RUN bootstrap.sh

WORKDIR /root/.lyra
RUN wget https://bs.scryptachain.org/latest.zip
RUN rm -rf blocks chainstate database
RUN unzip latest.zip

WORKDIR /opt
RUN echo "#!/bin/bash" > run.sh
RUN echo "lyrad && pm2 start npm -- start && pm2 save && npm run update" >> run.sh
RUN echo "tail -f /dev/null" >> run.sh
RUN chmod 777 run.sh
WORKDIR /opt/scrypta-idanodejs

EXPOSE 3001

ENTRYPOINT [ "/opt/run.sh" ]
CMD tail -f /dev/null