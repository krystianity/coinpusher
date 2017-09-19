"use strict";

const Promise = require("bluebird");
const path = require("path");
const fs = require("fs");
const debug = require("debug")("coinpusher:networkfactory");

const NeuronalNetwork = require("./NeuronalNetwork.js");

class NeuronalNetworkFactory {

    constructor(opts = {}){

        const {
            netDir,
            inputSize,
            outputSize
        } = opts;

        this.inputSize = inputSize;
        this.outputSize = outputSize;
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

        const start = Date.now();
        debug("creating new net");

        const nn = new NeuronalNetwork();
        nn.create(this.inputSize, 8, 4, this.outputSize);

        dataset = dataset.map(row => etlFunc(row));
        //TODO clean dataset? < 0, > 1, NaN, null, undefined checks
        debug("training", dataset.length, dataset[0].x.length, dataset[0].y.length);
        
        const results = nn.train(dataset); //TODO separate thread?
        debug("training done", (Date.now() - start) + "ms", results);
        
        return nn;
    }
}

module.exports = NeuronalNetworkFactory;