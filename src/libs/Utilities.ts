"use strict";
import express = require("express")
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
                form.maxFileSize = 20 * 1024 * 1024
                form.parse(req, function(err, fields, files) {
                    response ({
                        body: fields,
                        files: files
                    })
                })
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

  }

}

export = Utilities;