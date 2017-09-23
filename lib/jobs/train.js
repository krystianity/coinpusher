"use strict";

const {CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:jobs:train");

const {ETLS, DATASET_STEP, INPUT_FEATURES, OUTPUTS, STREAM_TO_DATASET} = require("./../Coinpusher.js");
const Coinstream = require("./../Coinstream.js");
const NeuronalNetworkFactory = require("./../NeuronalNetworkFactory.js");

const currency = process.argv[2];

if(!currency){
    console.log("please pass a currency.");
    process.exit(1);
}

if(!Object.keys(CURRENCY)
    .map(key => CURRENCY[key])
    .filter(c => c === currency)
    .length){
        console.log(currency + " does not exist.");
        process.exit(2);
}

function _getDatasetForCurrency(currency){
    //creates a copy of the dataset

    const stream = new Coinstream({
        tickerStream: null,
        currency
    });

    return stream.loadStreamFromDisk();
}

function _trainAndSaveForCurrency(currency){

    const nnFactory = new NeuronalNetworkFactory({
        inputSize: INPUT_FEATURES,
        outputSize: OUTPUTS
    });

    return _getDatasetForCurrency(currency).then(dataset => {
        dataset = STREAM_TO_DATASET(dataset);
        const nn = nnFactory.createNewNetwork(dataset, ETLS[currency].main);
        return nnFactory.saveNetwork(currency, nn).then(() => {
            return nn;
        });
    });
}

function updateNetworkForCurrency(currency){
    return _trainAndSaveForCurrency(currency).then(nn => {
        return true;
    });
}

updateNetworkForCurrency(currency).then(() => {
    process.exit(0);
}).catch(error => {
    debug(error);
    process.exit(3);
});