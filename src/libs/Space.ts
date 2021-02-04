"use strict";
import express = require("express")
import { format } from "url";
const fs = require('fs')
const aws = require('aws-sdk')
var download = require('download-file')
const LZUTF8 = require('lzutf8')
const fileType = require('file-type')
const mongo = require('mongodb').MongoClient
const axios = require('axios')

module Space {

  export class syncer {
    s3
    allKeys
    endpoint
    SpaceObj
    cToken

    constructor() {
      aws.config.update({
        accessKeyId: process.env.S3_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_KEY
      })
      this.endpoint = new aws.Endpoint(process.env.S3_ENDPOINT)
      this.s3 = new aws.S3({
        endpoint: this.endpoint
      })
    }

    async readSpace() {
      const app = this
      app.SpaceObj = []
      return new Promise(response => {
        try {
          app.s3.listObjectsV2({ Bucket: process.env.S3_BUCKET }, function (err, data) {
            if (err) {
              console.log(err)
              response(false)
            } else {
              app.SpaceObj = app.SpaceObj.concat(data.Contents);
              if (data.IsTruncated) {
                app.cToken = data.NextContinuationToken
                response(app.cToken)
              } else {
                response(app.SpaceObj)
              }
            }
          })
        } catch (e) {
          response(false)
        }
      })
    }

    uploadToSpace(hash, buffer, address) {
      return new Promise(async response => {
        try {
          var mime = await fileType.fromBuffer(buffer)
          if (mime) {
            this.s3.upload({
              Bucket: process.env.S3_BUCKET,
              ACL: 'public-read',
              Body: buffer,
              Key: address + '/' + hash,
              ContentType: mime.mime
            }, { Bucket: process.env.S3_BUCKET }, function (err, data) {
              if (err) {
                console.log(err)
                response(false)
              }
              let endpoint = LZUTF8.compress(process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT, { outputEncoding: "Base64" })
              let doublecheck = LZUTF8.decompress(endpoint, { inputEncoding: "Base64" })

              if (doublecheck === process.env.S3_BUCKET + '.' + process.env.S3_ENDPOINT) {
                response({
                  file: hash,
                  endpoint: endpoint
                })
              } else {
                response(false)
              }
            })
          } else {
            response(false)
          }
        } catch (e) {
          console.log(hash + ' not uploaded, retry.', e)
          response(false)
        }
      })
    }

    downloadFromSpace(spaceFile, endpoint, address) {
      return new Promise(response => {
        try {
          var url = "https://" + endpoint + '/' + address + '/' + spaceFile
          if (process.env.DEBUG === 'full') {
            console.log('DOWNLOADING REMOTE ' + url + ' IN TMP FOLDER')
          }
          var options = {
            directory: './tmp',
            filename: spaceFile
          }

          download(url, options, function (err) {
            if (err) {
              console.log(err)
              response(false)
            } else {
              if (process.env.DEBUG === 'full') {
                console.log("FILE " + spaceFile + " DOWNLOADED CORRECTLY")
              }
              let buffer = fs.readFileSync('./tmp/' + spaceFile)
              fs.unlinkSync('./tmp/' + spaceFile)
              response(buffer)
            }
          })
        } catch (e) {
          console.log('Downloading error.')
          response(false)
        }
      })
    }

    async syncSpace() {
      if (!global['isCheckingSpace']) {
        global['isCheckingSpace'] = true
        console.log('\x1b[45m%s\x1b[0m', 'SYNCING SPACE.')
        var space = new Space.syncer
        var files = {}
        let list: Object = await space.readSpace()
        if (list !== false) {
          for (let k in list) {
            let entry = list[k].Key.split('/')
            let address = entry[0]
            let key = entry[1]
            if (address !== undefined && address.length === 34) {
              if (files[address] === undefined) {
                files[address] = []
              }
              files[address].push(key)
            }
          }
          mongo.connect(global['db_url'], global['db_options'], async function (err, client) {
            var db = client.db(global['db_name'])
            let stored = await db.collection('written').find({ protocol: "documenta://" }).sort({ block: -1 }).toArray()
            let endpoints = []
            for (let k in stored) {
              if(stored[k].data.message !== undefined){
                let file = JSON.parse(stored[k].data.message)
                if (files[stored[k].data.address] === undefined || files[stored[k].data.address].indexOf(file.file) === -1) {
                  if (process.env.DEBUG === 'full') {
                    console.info('NEED TO DOWNLOAD THE FILE AND UPLOAD AGAIN')
                  }
                  let endpoint = LZUTF8.decompress(file.endpoint, { inputEncoding: "Base64" })
                  if(endpoints.indexOf(endpoint) === -1){
                    endpoints.push(endpoint)
                  }
                  let synced = false
                  let retries = 0
                  while(!synced){
                    retries ++
                    if(endpoints[retries] !== undefined){
                      endpoint = endpoints[retries]
                    }
                    let url = 'https://' + endpoint + '/' + stored[k].data.address + '/' + file.file
                    console.log('Downloading file from ' + url)
                    try {
                      let downloaded = await axios.get(url, { responseType: 'arraybuffer' })
                      if (downloaded.data !== undefined) {
                        let uploaded = await space.uploadToSpace(file.file, downloaded.data, stored[k].data.address)
                        if (uploaded === false) {
                          console.log('CAN\'T UPLOAD FILE!')
                        } else {
                          synced = true
                          console.log('FILE UPLOADED CORRECTLY!')
                        }
                      } else {
                        if (process.env.DEBUG === 'full') {
                          console.error('CAN\'T DOWNLOAD FILE, TRYING WITH ANOTHER SPACE!')
                        }
                      }
                    } catch (e) {
                      console.error('CAN\'T DOWNLOAD FILE!')
                      if(retries > endpoints.length){
                        synced = true
                      }
                    }
                  }
                } else {
                  if (process.env.DEBUG === 'full') {
                    console.log('FILE IS IN THE SPACE YET')
                  }
                }
              }
            }
            client.close()
            global['isCheckingSpace'] = false
          })
        }else{
          global['isCheckingSpace'] = false
        }
      }else{
        console.log('\x1b[41m%s\x1b[0m', 'SPACE IS SYNCING YET.')
      }
    }

  }

}

export = Space;