"use strict";

const {TickerStream, CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:main");
const moment = require("moment");
const path = require("path");
const {fork} = require("child_process");

const SocketServer = require("./SocketServer.js");
const Coinstream = require("./Coinstream.js");
const NeuronalNetworkFactory = require("./NeuronalNetworkFactory.js");

//turns a stream of trades (array containing x trades) into a dataset [{x,y}]
const DATASET_STEP = 80;
const INPUT_FEATURES = 5 * DATASET_STEP; //adjusts with TRADES_TO_ROW()
const OUTPUTS = 1 * DATASET_STEP;
const CONST_PRED_RANGE = 6 * 1000 * 60;
const PRED_STEPS = 5;
const MAX_CONST_PREDS = 100;

const STREAM_TO_DATASET = stream => {

    const dataset = [];
    let x = [];
    let y = [];
    let count = 0;
    stream.forEach(trade => {

        //comments assume DATASET_STEP == 10

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

const TIMESTAMP_TO_MOMENT = unix => {
    return moment.unix(parseInt(unix));
};

const TIMESTAMP_TO_HOUR = unix => {
    return TIMESTAMP_TO_MOMENT(unix).hours();
};

const TRADES_TO_ROW = (trades, factor) => {

    const row = [
        /* per trade: 10 * 5 = 50 features */

        //price / x (x = 1000)
        //amount / 1000
        //timestamp -> 24 hours / 24
        //buy 0/1 -> type
        //sell 0/1 -> type
    ];

    trades.forEach(trade => {
        row.push(trade.price / factor);
        row.push(trade.amount / 1000);
        row.push(TIMESTAMP_TO_HOUR(trade.timestamp) / 24);
        row.push(!trade.type ? 1 : 0);
        row.push(trade.type ? 1 : 0);
    });

    return row;
};

//map dataset trades [{x,y}] into price floats [{x,y}]
const ETLS = {
    [CURRENCY.ETH_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, 1000);
        },
        main: row => { //before training (is mapped)
            //const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, 1000);
            row.y = row.y.map(data => data.price / 1000);
            return row;
        },
        alter: value => value * 1000 //after prediction (is mapped)
    },
    [CURRENCY.BTC_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, 10000);
        },
        main: row => { //before training (is mapped)
           // const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, 10000);
            row.y = row.y.map(data => data.price / 10000);
            return row;
        },
        alter: value => value * 10000 //after prediction (is mapped)
    },
    [CURRENCY.LTC_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, 100);
        },
        main: row => { //before training (is mapped)
            //const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, 100);
            row.y = row.y.map(data => data.price / 100);
            return row;
        },
        alter: value => value * 100 //after prediction (is mapped)
    }
};

class Coinpusher {

    constructor(){

        this.nnFactory = new NeuronalNetworkFactory({
            inputSize: INPUT_FEATURES,
            outputSize: OUTPUTS
        });

        this.tickerStream = new TickerStream();

        this.ss = null;
        this.css = [];
        this.nets = {};
        this.buffers = {};
        this.constantPredictions = {};
    }

    _preFillBuffers(){
        this.css.forEach(cs => {
            this.buffers[cs.currency] = cs.getLatestTrades(DATASET_STEP);
            debug("prefilled buffers", cs.currency, this.buffers[cs.currency].length);
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
                    .predict(ETLS[currency].predict(this.buffers[currency]))
                    .map(ETLS[currency].alter);

                data = Object.assign({}, data, {predicted});
                const diff = predicted[predicted.length - 1] - predicted[0];
                debug("predicted trade", diff, predicted[0], predicted[predicted.length - 1]);
                this.checkConstantPrediction(currency, trade, predicted);
            }
        }

        if(this.ss){
            this.ss.broadcast(data);
        }
    }

    getConstantPredictions(currency){
        
        if(!this.constantPredictions[currency]){
            return [];
        }

        return this.constantPredictions[currency].predictions.slice(0);
    }

    checkConstantPrediction(currency, trade, predicted){
 
        if(!this.constantPredictions[currency]){
            debug("created cpreds for", currency);
            this.constantPredictions[currency] = {
                predictions: [],
                lastPrediction: null
            };
        }

        const lastPrediction = this.constantPredictions[currency].lastPrediction;
        if(!lastPrediction || lastPrediction + CONST_PRED_RANGE < Date.now()){
            debug("updating cpreds for", currency);

            const startTime = TIMESTAMP_TO_MOMENT(trade.timestamp);
            let count = 1;

            const newCtrades = [];
            predicted.forEach(prediction => {

                if(this.constantPredictions[currency].predictions.length >= MAX_CONST_PREDS){
                    this.constantPredictions[currency].predictions.shift();
                }

                let timestamp = startTime.clone();
                timestamp.add(count * PRED_STEPS, "seconds");
                timestamp = timestamp.valueOf() / 1000;
                count++;

                const ctrade = {
                    timestamp,
                    price: prediction
                };

                this.constantPredictions[currency].predictions.push(ctrade);
                newCtrades.push(ctrade);
            });

            this.constantPredictions[currency].lastPrediction = Date.now();

            if(this.ss){
                this.ss.broadcast({
                    currency,
                    ctrades: newCtrades
                });
            }
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

    //outsourced as job
    updateNetworkForCurrency(currency){
    
        const trainFork = new Promise((resolve, reject) => {
            const trainModule = path.join(__dirname, "./jobs/train.js");
            const child = fork(trainModule, [currency, "--max_old_space_size=8192"], {});
            child.on("close", code => {
                if(code === 0){
                    debug("net trained successfull");
                    return resolve(0);
                }
                debug("failed to train network", code);
                reject(code);
            });
        });

        return trainFork.then(() => {
            return this.nnFactory.loadNetwork(currency).then(nn => {
                this.nets[currency] = nn;
                debug("net loaded successfully", currency);
                return true;
            });
        });
    }

    startForBitcoin(){
        return this.start(CURRENCY.BTC_EUR, 3333);
    }

    startForEthereum(){
        return this.start(CURRENCY.ETH_EUR, 3334);
    }

    startForLitecoin(){
        return this.start(CURRENCY.LTC_EUR, 3335);
    }

    async start(currency, port){

        //due to the large memory consumption of
        //the networks it is not a good idea to run multiple streams
        //in the same process anymore
        this.css.push(new Coinstream({
            tickerStream: this.tickerStream,
            currency
        }));

        /*
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
        */

        await Promise.all(this.css.map(cs => cs.start())); //await start of all coinstreams

        this._preFillBuffers();

        //register for events
        this.css.forEach(cs => {
            cs.on("trade", this._onTrade.bind(this));
        });

        this.ss = new SocketServer({
            port
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

module.exports = {
    Coinpusher, 
    ETLS, 
    DATASET_STEP, 
    INPUT_FEATURES, 
    OUTPUTS, 
    STREAM_TO_DATASET
};