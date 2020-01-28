"use strict";
var fs = require('fs');
var archiver = require('archiver');

module Bootstrap {

  export class Bootstrap {

    public async create() {
        return new Promise(response => {
            let dotlyrafolder = process.env.LYRADATAFOLDER
            console.log('STARTING BOOTSTRAP CREATION')
            var output = fs.createWriteStream('./public/bootstrap.zip');
            var archive = archiver('zip', {
                zlib: { level: 9 }
            });
            
            output.on('close', function() {
                console.log('BOOTSTRAP FILE CREATED, SIZE IS ' + archive.pointer());
            });
                        
            archive.on('warning', function(err) {
                if (err.code === 'ENOENT') {
                    console.log(err)
                } else {
                    console.log(err)
                }
            });
            
            archive.on('error', function(err) {
                console.log(err);
            });
            
            archive.pipe(output);
            var testnetfolder = ''
            if(process.env.TESTNET !== undefined){
                if(process.env.TESTNET === 'true' || process.env.TESTNET === true){
                    testnetfolder = '/testnet4'
                }
            }
            try{
                archive.directory(dotlyrafolder + testnetfolder + '/blocks/', 'blocks');
                archive.directory(dotlyrafolder + testnetfolder + '/chainstate/', 'chainstate');
                archive.finalize();
            }catch(e){
                console.log('BOOTSTRAP FAILED')
            }
        })
    }

  }

}

export = Bootstrap;