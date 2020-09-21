import express = require("express")
const fileType = require('file-type')
var formidable = require('formidable')
var fs = require('fs')
const axios = require('axios')

export async function info(req: express.Request, res: express.Response) {
  let version = await global['ipfs'].version()
  const multiAddrs = await global['ipfs'].swarm.localAddrs()
  let listenerAddress = multiAddrs[1].toString('hex')
  const connected = await global['ipfs'].swarm.peers()

  res.send({
    info: version,
    peer: listenerAddress,
    connected: connected,
    status: 200
  })
};

export async function add(req: express.Request, res: express.Response) {
  var form = new formidable.IncomingForm();
  form.maxFileSize = global['limit'] * 1024 * 1024
  form.maxFieldsSize = global['limit'] * 1024 * 1024
  form.multiples = true
  if (req.body.buffer !== undefined) {
    let buf = Buffer.from(req.body.buffer, 'hex')
    try {
      let results = await global['ipfs'].add(buf, { pin: global['pinipfs'] })
      console.log(results)
      res.send({
        data: results,
        status: 200
      })
    } catch (e) {
      res.send({
        error: true,
        status: 500
      })
    }
  } else {
    form.parse(req, async function (err, fields, files) {
      if (fields.buffer !== undefined) {
        let buf = Buffer.from(fields.buffer, 'hex')
        try {
          let results = await global['ipfs'].add(buf, { pin: global['pinipfs'] })
          res.send({
            data: results.path,
            status: 200
          })
        } catch (e) {
          res.send({
            error: true,
            status: 500
          })
        }
      } else if (files.files !== undefined) {
        if (fields.folder !== undefined) {
          var ipfscontents = new Array()
          for (var k in files.files) {
            var file = fs.readFileSync(files.files[k].path)
            var ipfsobj = {
              path: fields.folder + '/' + files.files[k].name,
              content: file
            }
            ipfscontents.push(ipfsobj)
          }
          let results = []
          for await (const result of global['ipfs'].addAll(ipfscontents)) {
            results.push({
              path: result.path,
              hash: result.cid.toString()
            })
          }
          res.send({
            data: results,
            status: 200
          })
        } else {
          res.send({
            data: {
              error: "Specify folder first."
            },
            status: 422
          })
        }
      } else {
        if (files.file !== undefined) {
          var content = fs.readFileSync(files.file.path)
          global['ipfs'].add(content, { pin: global['pinipfs'] }).then(results => {
            const hash = results.path
            res.send({
              data: {
                hash: hash
              },
              status: 200
            })
          })
        } else {
          res.send({
            data: {
              error: "Specify one or more file first."
            },
            status: 422
          })
        }
      }
    })
  }
};

export function addfile(path) {
  return new Promise(response => {
    var content = fs.readFileSync(path)
    global['ipfs'].add(content, { pin: global['pinipfs'] }).then(results => {
      const hash = results[0].hash
      response(hash)
    })
  })
}

export function addfolder(files, folder) {
  return new Promise(response => {
    var ipfscontents = new Array()
    for (var k in files) {
      var file = fs.readFileSync(files[k].path)
      var ipfsobj = {
        path: folder + '/' + files[k].name,
        content: file
      }
      ipfscontents.push(ipfsobj)
    }
    global['ipfs'].add(ipfscontents, { pin: global['pinipfs'] }).then(results => {
      response(results)
    })
  })
}

export function verify(req: express.Request, res: express.Response) {
  var hash = req.params.hash
  var form = new formidable.IncomingForm();
  let timeout = setTimeout(function () {
    res.send(false)
  }, 1000)
  form.parse(req)
  form.on('file', function (name, file) {
    fs.readFile(file.path, { onlyHash: true }, function (error, content) {
      global['ipfs'].add(content).then(results => {
        var calculated = results.cid.toString()
        clearTimeout(timeout)
        if (calculated !== hash) {
          res.send(false)
        } else {
          res.send(true)
        }
      })
    })
  });
};

export function ls(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  try {
    let result = global['ipfs'].ls(hash)
    res.send(result)
  } catch (e) {
    res.send(e)
  }
};

export function getfolder(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  const folder = req.params.folder
  global['ipfs'].cat(hash + '/' + folder, async function (err, file) {
    if (err) {
      throw err
    }
    var mimetype = await fileType.fromBuffer(file)
    if (mimetype) {
      res.setHeader('Content-Type', mimetype.mime);
    }
    res.end(file)
  })
};

export function getfilebuffer(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  let response = false
  let timeout = setTimeout(async function () {
    let nodes = await axios.get('https://raw.githubusercontent.com/scryptachain/scrypta-idanode-network/master/peers')
    let bootstrap = nodes.data.split("\n")
    for (let k in bootstrap) {
      let node = bootstrap[k].split(':')
      try {
        axios.get('http://' + node[1] + ':3001/ipfs-fallback/' + hash).then(async file => {
          if (!response && file.data.status !== 400) {
            response = true
            let buf = Buffer.from(file.data, 'hex')
            res.send({
              data: buf,
              status: 200
            })
          }
        }).catch(e => {
          console.log("Can't connect to node")
        })
      } catch (e) {
        console.log("Can't connect to node.")
      }
    }
  }, 500)

  global['ipfs'].get(hash, function (err, file) {
    if (!response) {
      if (err) {
        console.log(err)
      } else {
        response = true
        clearTimeout(timeout)
        res.send({
          data: file,
          status: 200
        })
      }
    }
  })
};

export async function getfile(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  let response = false
  try {
    let timeout = setTimeout(async function () {
      let nodes = await axios.get('https://raw.githubusercontent.com/scryptachain/scrypta-idanode-network/master/peers')
      let bootstrap = nodes.data.split("\n")
      for (let k in bootstrap) {
        let node = bootstrap[k].split(':')
        try {
          axios.get('http://' + node[1] + ':3001/ipfs-fallback/' + hash).then(async file => {
            if (!response && file.data.status !== 400) {
              response = true
              res.setHeader('Content-Type', file.headers['content-type'])
              let buf = Buffer.from(file.data, 'hex')
              res.send(buf)
            }
          }).catch(e => {
            console.log("Can't connect to node")
          })
        } catch (e) {
          console.log("Can't connect to node.")
        }
      }
    }, 500)
    for await (const file of global['ipfs'].get(hash)) {
      if (!file.content) continue;
      const content = []

      for await (const chunk of file.content) {
        content.push(chunk)
      }
      var mimetype = await fileType.fromBuffer(content[0])
      if (mimetype) {
        res.setHeader('Content-Type', mimetype.mime);
      }
      clearTimeout(timeout)
      res.end(content[0])
    }
  } catch (e) {
    console.log(e)
    res.send({ success: false, status: 500 })
  }
};

export function fallbackfile(req: express.Request, res: express.Response) {
  const hash = req.params.hash

  global['ipfs'].cat(hash, async function (err, file) {
    if (err) {
      global['ipfs'].ls(hash, function (err, result) {
        if (err) {
          res.send({
            message: 'CAN\'T RETRIEVE FILE OR FOLDER',
            status: 400
          })
        } else {
          res.send(result)
        }
      })
    } else {
      var mimetype = await fileType.fromBuffer(file)
      if (mimetype) {
        res.setHeader('Content-Type', mimetype.mime);
      }
      res.end(file.toString('hex'))
    }
  })
};

export async function filetype(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  let response = false
  try {
    let timeout = setTimeout(async function () {
      let nodes = await axios.get('https://raw.githubusercontent.com/scryptachain/scrypta-idanode-network/master/peers')
      let bootstrap = nodes.data.split("\n")
      for (let k in bootstrap) {
        let node = bootstrap[k].split(':')
        try {
          axios.get('http://' + node[1] + ':3001/ipfs-fallback-type/' + hash).then(file => {
            if (!response && file.data.status === undefined) {
              response = true
              res.send(file.data)
            }
          }).catch(e => {
            console.log("Can't connect to node")
          })
        } catch (e) {
          console.log("Can't connect to node.")
        }
      }
      setTimeout(function () {
        res.send({ message: "FileType not available", status: 400 })
      }, 5000)
    }, 500)

    for await (const file of global['ipfs'].get(hash)) {
      if (!file.content) continue;
      const content = []

      for await (const chunk of file.content) {
        content.push(chunk)
      }
      var mimetype = await fileType.fromBuffer(content[0])
      console.log(mimetype)
      if (!response) {
        response = true
        clearTimeout(timeout)
        res.send({
          data: mimetype.mime,
          status: 200
        })
      }
    }
  } catch (e) {
    console.log(e)
    res.send({ success: false, status: 500 })
  }
};

export function fallbackfiletype(req: express.Request, res: express.Response) {
  const hash = req.params.hash
  global['ipfs'].cat(hash, async function (err, file) {
    if (err) {
      res.send({
        message: 'CAN\'T RETRIEVE FILE',
        status: 400
      })
    } else {
      var mimetype = await fileType.fromBuffer(file)
      if (mimetype) {
        let details = mimetype.mime.split('/')
        mimetype.type = details[0]
        res.send({
          data: mimetype,
          status: 200
        })
      } else {
        res.send({
          message: 'CAN\'T RETRIEVE FILE',
          status: 400
        })
      }
    }
  })
};

export async function pins(req: express.Request, res: express.Response) {
  let pinset = await global['ipfs'].pin.ls({ type: 'recursive' })

  res.send({
    data: pinset,
    status: 200
  })
};
