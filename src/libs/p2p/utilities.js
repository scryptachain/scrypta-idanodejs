var express = require("express")
var formidable = require('formidable')

module.exports = {
    parse: async function (req) {
        return new Promise(response => {
            var jsonEmpty = true
            for (var key in req.body) {
                if(key !== undefined){
                    jsonEmpty = false
                }
            }
            if(jsonEmpty === true){
                var form = new formidable.IncomingForm()
                form.parse(req, function(err, fields, files) {
                    response ({
                        body: fields,
                        files: files
                    })
                })
                setTimeout(function(){
                    response(false)
                },200)
            } else {
                response ({
                    body: req.body,
                    files: []
                })
            }
        })
    }
}