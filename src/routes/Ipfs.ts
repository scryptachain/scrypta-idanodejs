import express = require("express")
const fileType = require('file-type')
var formidable = require('formidable')
var fs = require('fs')

export function info(req: express.Request, res: express.Response) {
    global['ipfs'].version(function (err, version) {
        if (err) {
          throw err
        }
        res.send({
            info: version,
            status: 200
        })
    })
};

export function add(req: express.Request, res: express.Response) {
    var form = new formidable.IncomingForm();
    form.multiples = true
    form.parse(req, function(err, fields, files) {
      if(files.files !== undefined){
        if(fields.folder !== undefined){
          var ipfscontents = new Array()
          for(var k in files.files){
            var file = fs.readFileSync(files.files[k].path)
            var ipfsobj = {
              path: fields.folder + '/' + files.files[k].name,
              content: file
            }
            ipfscontents.push(ipfsobj)
          }
          global['ipfs'].add(ipfscontents).then(results => {
            res.send({
              data: results,
              status: 200
            })
          })
        }else{
          res.send({
            data: {
              error: "Specify folder first."
            },
            status: 422
          })
        }
      }else{
        if(files.file !== undefined){
          var content = fs.readFileSync(files.file.path)
          global['ipfs'].add(content).then(results => {
            const hash = results[0].hash
            res.send({
              data: {
                hash: hash
              },
              status: 200
            })
          })
        }else{
          res.send({
            data: {
              error: "Specify one or more file first."
            },
            status: 422
          })
        }
      }
    })
};

export function addfile(path) {
  return new Promise (response => {
    var content = fs.readFileSync(path)
      global['ipfs'].add(content).then(results => {
        const hash = results[0].hash
        response(hash)
      })
  })
}

export function addfolder(files, folder) {
  return new Promise (response => {
    var ipfscontents = new Array()
    for(var k in files){
      var file = fs.readFileSync(files[k].path)
      var ipfsobj = {
        path: folder + '/' + files[k].name,
        content: file
      }
      ipfscontents.push(ipfsobj)
    }
    global['ipfs'].add(ipfscontents).then(results => {
      response(results)
    })
  })
}

export function verify(req: express.Request, res: express.Response) {
    var hash = req.params.hash
    var form = new formidable.IncomingForm();
    form.parse(req)
    form.on('file', function (name, file){
        fs.readFile(file.path, {onlyHash: true}, function(error, content){
          global['ipfs'].add(content).then(results => {
            var calculated = results[0].hash
            if(calculated !== hash){
              res.send(false)
            }else{
              res.send(true)
            }
          })
        })
    });
    setTimeout(function(){
        res.send(false)
    },1000)
};

export function ls(req: express.Request, res: express.Response) {
    const hash = req.params.hash
    global['ipfs'].ls(hash, function (err, result) {
      if (err) {
          throw err
      }
      res.send(result)
    })
};

export function getfolder(req: express.Request, res: express.Response) {
    const hash = req.params.hash
    const folder = req.params.folder
    global['ipfs'].cat(hash + '/' + folder, function (err, file) {
      if (err) {
          throw err
      }
      var mimetype = fileType(file)
      if(mimetype){
        res.setHeader('Content-Type', mimetype.mime);
      }
      res.end(file)
    })
};

export function getfile(req: express.Request, res: express.Response) {
    const hash = req.params.hash
    global['ipfs'].cat(hash, function (err, file) {
      if (err) {
        global['ipfs'].ls(hash, function (err, result) {
            if (err) {
                res.send({
                    message: 'CAN\'T RETRIEVE FILE OR FOLDER',
                    status: 400
                })
            }else{
                res.send(result)
            }
        })
      }else{
        var mimetype = fileType(file)
        if(mimetype){
            res.setHeader('Content-Type', mimetype.mime);
        }
        res.end(file)
      }
    })
};

export function filetype(req: express.Request, res: express.Response) {
    const hash = req.params.hash
    global['ipfs'].cat(hash, function (err, file) {
      if (err) {
        res.send({
            message: 'CAN\'T RETRIEVE FILE',
            status: 400
        })
      }else{
        var mimetype = fileType(file)
        if(mimetype){
            res.send({
                data: mimetype,
                status: 200
            })
        }else{
            res.send({
                message: 'CAN\'T RETRIEVE FILE',
                status: 400
            })
        }
      }
    })
};

export function pins(req: express.Request, res: express.Response) {
    global['ipfs'].pin.ls({ type: 'recursive' }, function (err, pinset) {
        if (err) {
            throw err
        }
        res.send({
            data: pinset,
            status: 200
        })
    })
};

export function addhash(req: express.Request, res: express.Response) {
    const hash = req.params.hash
    global['ipfs'].pin.add(hash, function (err) {
      if (err) {
        throw err
      }
      res.send({
        data: true,
        status: 200
      })
    })
};