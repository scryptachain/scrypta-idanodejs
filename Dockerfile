FROM node:8-alpine

RUN apk update && apk add --no-cache git python && apk add build-base  

RUN mkdir /opt/src

COPY src /opt/src

COPY package.json /opt/
COPY tsconfig.json /opt/

WORKDIR /opt/

RUN npm install

RUN npm run-script tsc

EXPOSE 3001

CMD ["npm","run-script","start"]

