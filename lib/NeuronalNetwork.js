"use strict";

const synaptic = require("synaptic");
const { Layer, Network, Architect, Trainer } = synaptic;

const LSTM_OPTIONS = {
    peepholes: Layer.connectionType.ALL_TO_ALL,
    hiddenToHidden: false,
    outputToHidden: false,
    outputToGates: false,
    inputToOutput: false
};

const TRAIN_OPTIONS = {
    rate: 0.05,
    clear: true,
    iterations: 10000,
    error: 0.005,
    cost: null,
    crossValidate: null
};

class NeuronalNetwork {

    constructor(){
        this.nn = null;
        this.trainer = null;
    }

    create(...args){
        args.push(LSTM_OPTIONS);
        this.nn = new Architect.LSTM(...args);
        this.trainer = new Trainer(this.nn);
    }

    train(dataset){
        dataset = this._datasetToTrainingSet(dataset);
        return this.trainer.train(dataset, TRAIN_OPTIONS);
    }

    predict(data){
        return this.nn.activate(data);
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
}

module.exports = NeuronalNetwork;