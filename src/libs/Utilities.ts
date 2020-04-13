"use strict";
import express = require("express")
import { format } from "url";
var formidable = require('formidable')

module Utilities {

  export class Parser {

    public async body(req: express.Request) {
        return new Promise(response => {
            var jsonEmpty = true
            for (var key in req.body) {
                if(key !== undefined){
                    jsonEmpty = false
                }
            }
            if(jsonEmpty === true){
                var form = new formidable.IncomingForm()
                form.maxFileSize = global['limit'] * 1024 * 1024
                form.maxFieldsSize = global['limit'] * 1024 * 1024
                form.parse(req, function(err, fields, files) {
                    if(err){
                        console.log(err)
                    }
                    response ({
                        body: fields,
                        files: files
                    })
                })
                /*setTimeout(function(){
                    response(false)
                },200)*/
            } else {
                response ({
                    body: req.body,
                    files: []
                })
            }
        })
    }

    public hex2a(hexx) {
        var hex = hexx.toString();
        var str = '';
        for (var i = 0; (i < hex.length && hex.substr(i, 2) !== '00'); i += 2)
            str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return str;
    }

    public timeToDate(time){
        var date = new Date(time)
        var year = date.getFullYear()
        var month = date.getMonth() + 1
        var day = date.getDate()
        var hours = date.getHours()
        var minutes = "0" + date.getMinutes()
        var seconds = "0" + date.getSeconds()
        var formattedTime = day + '/' + month + '/' + year +' at ' + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2)
        return formattedTime
    }
  }

}

export = Utilities;