"use strict";

const {TickerStream, CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:main");

const SocketServer = require("./SocketServer.js");
const Coinstream = require("./Coinstream.js");
const NeuronalNetworkFactory = require("./NeuronalNetworkFactory.js");

//turns a stream of trades (array containing x trades) into a dataset [{x,y}]
const DATASET_STEP = 10;

const STREAM_TO_DATASET = stream => {

    const dataset = [];
    let x = [];
    let y = [];
    let count = 0;
    stream.forEach(trade => {

        //first 10 to x, second 10 to y
        if(count < DATASET_STEP){
            x.push(trade);
        } else {
            y.push(trade);
        }
        count++;

        //when 20 is reached push x,y as object to dataset
        //and reset
        if((x.length + y.length) === (DATASET_STEP * 2)){
            count = 0;
            dataset.push({
                x: x.slice(0),
                y: y.slice(0)
            });
            x = [];
            y = [];
        }
    });
    return dataset;
};

//map dataset trades [{x,y}] into price floats [{x,y}]
const ETLS = {
    [CURRENCY.ETH_EUR]: {
        predict: data => data.price / 1000, //before prediction
        alter: value => value * 1000, //after prediction
        main: row => { //before training
            row.x = row.x.map(data => data.price / 1000);
            row.y = row.y.map(data => data.price / 1000);
            return row;
        }
    },
    [CURRENCY.BTC_EUR]: {
        predict: data => data.price / 10000, //before prediction
        alter: value => value * 10000, //after prediction
        main: row => { //before training
            row.x = row.x.map(data => data.price / 10000);
            row.y = row.y.map(data => data.price / 10000);
            return row;
        }
    },
    [CURRENCY.LTC_EUR]: {
        predict: data => data.price / 100, //before prediction
        alter: value => value * 100, //after prediction
        main: row => { //before training
            row.x = row.x.map(data => data.price / 100);
            row.y = row.y.map(data => data.price / 100);
            return row;
        }
    }
};

class Coinpusher {

    constructor(){

        this.nnFactory = new NeuronalNetworkFactory({
            inputSize: DATASET_STEP,
            outputSize: DATASET_STEP
        });

        this.tickerStream = new TickerStream();

        this.ss = null;
        this.css = [];
        this.nets = {};
        this.buffers = {};
    }

    _getDatasetForCurrency(currency){
        //creates a copy of the dataset

        for(let i = 0; i < this.css.length; i++){
            if(this.css[i].currency === currency){
                return this.css[i].loadStreamFromDisk();
            }
        }

        debug("no dataset found for currency", currency);
        return Promise.reject(currency + " dataset not present");
    }

    _trainAndSaveForCurrency(currency){
        return this._getDatasetForCurrency(currency).then(dataset => {
            dataset = STREAM_TO_DATASET(dataset);
            const nn = this.nnFactory.createNewNetwork(dataset, ETLS[currency].main);
            return this.nnFactory.saveNetwork(currency, nn).then(() => {
                return nn;
            });
        });
    }

    _appendBuffer(currency, data){

        if(!this.buffers[currency]){
            this.buffers[currency] = [];
        }

        if(this.buffers[currency].length >= DATASET_STEP){
            this.buffers[currency].shift();
        }

        this.buffers[currency].push(data);
    }

    _onTrade(data = {}){

        const {currency, trade} = data;
        this._appendBuffer(currency, trade);

        if(this.buffers[currency].length >= DATASET_STEP){
            if(this.nets[currency]){

                if(!ETLS[currency]){
                    return debug("no etl function supports currency", currency);
                }

                const predicted = this.nets[currency]
                    .predict(this.buffers[currency].map(ETLS[currency].predict))
                    .map(ETLS[currency].alter);

                data = Object.assign({}, data, {predicted});
                const diff = predicted[predicted.length - 1] - predicted[0];
                debug("predicted trade", diff, predicted[0], predicted[predicted.length - 1]);
            }
        }

        if(this.ss){
            this.ss.broadcast(data);
        }
    }

    getNetworkStats(){

        const stats = {};
        Object.keys(this.nets).forEach(key => {
            stats[key] = {
                //TODO
            };
        });

        return stats;
    }

    getAvailableCurrencies(){
        return CURRENCY;
    }

    updateNetworkForCurrency(currency){
        return this._trainAndSaveForCurrency(currency).then(nn => {
            this.nets[currency] = nn;
            return true;
        }).catch(error => {
            debug("failed to train nn", currency, error);
            return false;
        });
    }

    readAvailableNetworksFromDisk(){
        const promises = this.css.map(cs => {
            return this.nnFactory.loadNetwork(cs.currency).then(nn => {
                this.nets[cs.currency] = nn;
                debug("net loaded successfully", cs.currency);
                return true;
            }).catch(error => {
                debug("failed to load net for", cs.currency);
                return false;
            });
        });
        return Promise.all(promises);
    }

    async start(){

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.ETH_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.BTC_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.LTC_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.XRP_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.EUR_USD
        }));

        await Promise.all(this.css.map(cs => cs.start())); //await start of all coinstreams

        //register for events
        this.css.forEach(cs => {
            cs.on("trade", this._onTrade.bind(this));
        });

        this.ss = new SocketServer({
            port: 3333
        }, this);

        await this.ss.start();
        await this.readAvailableNetworksFromDisk(); //load ./nets

        return this;
    }

    close(){

        if(this.tickerStream){
            this.tickerStream.close();
        }

        if(this.ss){
            this.ss.close();
        }

        this.css.forEach(cs => cs.close());
    }
}

module.exports = Coinpusher;