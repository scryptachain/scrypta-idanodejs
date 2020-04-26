"use strict";
import express = require("express")
import { format } from "url";
var formidable = require('formidable')
const fs = require('fs')

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

    public log(what){
        const path = './log'

        try {
            if (!fs.existsSync(path)) {
                fs.writeFileSync('log', "");
            }
            console.log(what)
            let date_ob = new Date();
            let date = ("0" + date_ob.getDate()).slice(-2);

            let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
            let year = date_ob.getFullYear();
            let hours = date_ob.getHours();
            let minutes = date_ob.getMinutes();
            let seconds = date_ob.getSeconds();

            let datetime = '['+year + "-" + month + "-" + date + " " + hours + ":" + minutes + ":" + seconds+']';

            fs.appendFileSync('log', datetime + ' ' + what + "\n");
        } catch(err) {
        console.error(err)
        }
    }
  }

}

export = Utilities;