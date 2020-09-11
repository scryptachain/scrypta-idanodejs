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
          console.log('Remote file ' + url + ' downloading in tmp folder')

          var options = {
            directory: './tmp',
            filename: spaceFile
          }

          download(url, options, function (err) {
            if (err) {
              console.log(err)
              response(false)
            } else {
              console.log("Downloaded correctly.")
              response(true)
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
            let stored = await db.collection('documenta').find().sort({ time: -1 }).toArray()
            for(let k in stored){
              let file = stored[k]
              if (files[file.address] === undefined || files[file.address].indexOf(file.file) === -1) {
                if(process.env.DEBUG === 'full'){
                  console.info('NEED TO DOWNLOAD THE FILE AND UPLOAD AGAIN')
                }
                let endpoint = LZUTF8.decompress(file.endpoint, { inputEncoding: "Base64" })
                let url = 'https://' + endpoint + '/' + file.address + '/' + file.file
                try {
                  let downloaded = await axios.get(url, { responseType: 'arraybuffer' })
                  if (downloaded.data !== undefined) {
                    let uploaded = await space.uploadToSpace(file.file, downloaded.data, file.address)
                    if(process.env.DEBUG === 'full'){
                      if (uploaded === false) {
                        console.log('CAN\'T UPLOAD FILE!')
                      } else {
                        console.info('UPLOADED CORRECTLY')
                      }
                    }
                  } else {
                    if(process.env.DEBUG === 'full'){
                      console.error('CAN\'T DOWNLOAD FILE!')
                    }
                  }
                } catch (e) {
                  console.error('CAN\'T DOWNLOAD FILE!')
                }
              } else {
                if(process.env.DEBUG === 'full'){
                  console.log('FILE IS IN THE SPACE YET')
                }
              }
            }
            global['isCheckingSpace'] = false
          })
        }
      }
    }
    
  }

}

export = Space;