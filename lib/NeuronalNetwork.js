"use strict";

const synaptic = require("synaptic");

const Network = synaptic.Network;
const Trainer = synaptic.Trainer;
const Architect = synaptic.Architect;

class NeuronalNetwork {

    constructor(){
        this.nn = null;
        this.trainer = null;
    }

    //converts a coinstream fs file to a synaptic file x,y -> input,output
    _datasetToTrainingSet(dataset){
        return dataset.map(row => {
            return {
                input: row.x,
                output: row.y  
            };
        });
    }

    create(...args){
        this.nn = new Architect.Perceptron(...args);
        this.trainer = new Trainer(this.nn);
    }

    train(dataset){
        dataset = this._datasetToTrainingSet(dataset);
        return this.trainer.train(dataset);
    }

    fromJSON(json){
        json = Buffer.isBuffer(json) ? json.toString("utf8") : json;
        json = typeof json !== "object" ? JSON.parse(json) : json;
        this.nn = Network.fromJSON(json);
        this.trainer = new Trainer(this.nn);
    }

    toJSON(){
        return this.nn.toJSON();
    }

    toString(){
        return JSON.stringify(this.toJSON());
    }

    predict(data){
        return this.nn.activate(data);
    }
}

module.exports = NeuronalNetwork;