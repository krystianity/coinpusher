"use strict";

const {TickerStream, CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:main");

const SocketServer = require("./SocketServer.js");
const Coinstream = require("./Coinstream.js");
const NeuronalNetworkFactory = require("./NeuronalNetworkFactory.js");

const ETL_ROW = data => data.price / 1e4;

const ETL_FUNC = row => {
    //TODO this is a very bad basis to predict
    row.x = row.x.map(ETL_ROW);
    row.y = row.y.map(ETL_ROW);
    return row;
};

class Coinpusher {

    constructor(){

        this.nnFactory = new NeuronalNetworkFactory();
        this.tickerStream = new TickerStream();

        this.ss = null;
        this.css = [];
        this.nets = {};
        this.buffers = {};
    }

    _getDatasetForCurrency(currency){
        return this.css.filter(cs => cs.currency === currency)[0].dataset;
    }

    _trainAndSaveForCurrency(currency){

        const nn = this.nnFactory.createNewNetwork(this._getDatasetForCurrency(currency), ETL_FUNC);
        return this.nnFactory.saveNetwork(currency, nn).then(() => {
            return nn;
        });
    }

    _appendBuffer(currency, data){

        if(!this.buffers[currency]){
            this.buffers[currency] = [];
        }

        if(this.buffers[currency].length >= 10){  //TODO 10 must not be hard coded
            this.buffers[currency].shift();
        }

        this.buffers[currency].push(data);
    }

    _onTrade(data = {}){

        const {currency, trade} = data;

        this._appendBuffer(currency, trade);
        if(this.buffers[currency].length >= 10){ //TODO 10 must not be hard coded
            if(this.nets[currency]){
                const predicted = this.nets[currency].predict(this.buffers[currency].map(ETL_ROW));
                debug("predicting trades", predicted);
                data = Object.assign({}, data, {predicted});
            }
        }

        if(this.ss){
            this.ss.broadcast(data);
        }
    }

    _onStep(data = {}){

        const {currency, collected} = data;

        if(this.nets[currency]){
            const predicted = this.nets[currency].predict(collected.x.map(ETL_ROW));
            debug("predicting step", predicted);
            data = Object.assign({}, data, {predicted});
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
            console.error(error);
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
            currency: CURRENCY.BTC_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.ETH_EUR
        }));

        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency: CURRENCY.LTC_EUR
        }));

        await Promise.all(this.css.map(cs => cs.start())); //await start of all coinstreams

        //register for events
        this.css.forEach(cs => {
            cs.on("trade", this._onTrade.bind(this));
            cs.on("step", this._onStep.bind(this));
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