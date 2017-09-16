"use strict";

const Promise = require("bluebird");
const path = require("path");
const fs = require("fs");
const debug = require("debug")("coinpusher:networkfactory");

const NeuronalNetwork = require("./NeuronalNetwork.js");

class NeuronalNetworkFactory {

    constructor(opts = {}){

        const {
            netDir
        } = opts;

        this.netDir = netDir || path.join(__dirname, "./../nets");
    }

    getNetworkFile(name){
        return path.join(this.netDir, `${name}.nn`);
    }

    loadNetwork(name){
        debug("loading net", name);
        return new Promise((resolve, reject) => {
            fs.readFile(this.getNetworkFile(name), (error, data) => {

                if(error){
                    return reject(error);
                }

                data = Buffer.isBuffer(data) ? data.toString("utf8") : data;
                const size = Buffer.byteLength(data, "utf8") / 1000;
                debug("net loaded", name, size, "kb");
                
                const nn = new NeuronalNetwork();
                try {
                    nn.fromJSON(data);
                } catch(error){
                    return reject(error);
                }
                
                resolve(nn);
            });
        });
    }

    saveNetwork(name, nn){
        return new Promise((resolve, reject) => {
            
            debug("saving net", name);
            fs.writeFile(this.getNetworkFile(name), nn.toString(), error => {
                
                if(error){
                    return reject(error);
                }

                resolve();
            });
        });
    }

    createNewNetwork(dataset, etlFunc = d => d){

        debug("creating new net");

        const nn = new NeuronalNetwork();
        nn.create(10, 6, 4, 2, 10);

        dataset = dataset.map(row => etlFunc(row));
        debug("training", dataset.length, dataset[0].x.length, dataset[0].y.length);
        
        nn.train(dataset);
        debug("training done");
        
        return nn;
    }
}

module.exports = NeuronalNetworkFactory;