"use strict";

const {TickerStream, CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:main");
const moment = require("moment");
const path = require("path");
const uuid = require("uuid");
const {fork} = require("child_process");
const EventEmitter = require("events");

const SocketServer = require("./SocketServer.js");
const Coinstream = require("./Coinstream.js");
const NeuronalNetworkFactory = require("./NeuronalNetworkFactory.js");

//turns a stream of trades (array containing x trades) into a dataset [{x,y}]
const DATASET_STEP = 140;
const INPUT_FEATURES = 5 * DATASET_STEP; //adjusts with TRADES_TO_ROW()
const OUTPUTS = 2 * DATASET_STEP - 2; //first is skipped

const CONST_PRED_RANGE = 6 * 1000 * 60;
const PRED_STEPS = 5;
const MAX_CONST_PREDS = 1 * DATASET_STEP;
const MAX_DRIFTS = 36;
const MAX_PERFORMANCE_BUFFER_SIZE = 36;

const BTC_EUR_FACTOR = 10000; // 2440.0 -> 0.24400
const ETH_EUR_FACTOR = 1000; // 244.0 -> 0.2440
const LTC_EUR_FACTOR = 100; //24.0 -> 0.240
const ETL_FACTOR = 100; //brings a drift below 1

/**
 * turns a a trade stream (single array)
 * into an [{x,y}] array where a set amount of elements
 * is taken and split in half for x and the other half y
 * this way we can take the first n elements and map them to the
 * following n elements for predictions of the course
 * @param {*} stream 
 */
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

/**
 * X-NORMALISATION
 * turns a trade object (actually a list of them)
 * into a single array, breaks a single trade element into multiple
 * vector elements to train the network
 * @param {*} trades 
 * @param {*} factor 
 */
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

/**
 * Y-NORMALISATION
 * similiar to TRADES_TO_ROW which is applied to x rows
 * this function is applied to y rows and determines the
 * neuronal networks output vectors 
 * (applys normalization to dataset y rows)
 * @param {*} trades 
 * @param {*} factor 
 */
const TRADES_TO_ROW_OUTPUT = (trades, factor) => {

    const row = [
        /* per trade: 10 - 1  * 2 = 18 features */

        //drift lastprice - currentprice / 100
        //positive 
    ];

    //take first
    let lastPrice = trades[0].price;
    //skip first
    trades.slice(1, trades.length).forEach(trade => {

        let drift = lastPrice - trade.price;
        const positive = drift > 0 ? 1 : 0;
        drift = positive === 0 ? drift * -1 : drift;

        row.push(drift / factor);
        row.push(positive);

        lastPrice = trade.price;
    });

    return row;
};

/**
 * OUTPUT RE-NORMALISATION
 * @param {*} outputs 
 * @param {*} factor 
 */
const OUTPUT_TO_TRADE_PRICES = (outputs, factor, trade) => {

    const prices = [
        /* per prediction: 18 / 2 = 9 */

        //price
    ];

    let currentPrice = trade.price; //use real-price for the layout of the prediction

    for(let i = 0; i < outputs.length; i += 2){
        
        let diff = outputs[i];
        if(outputs[i+1] < 0.5){ //check if positve or negative trend
            diff *= -1;
        }
        diff *= factor;

        //apply to current price
        currentPrice = currentPrice + diff;
        prices.push(currentPrice);
    }

    return prices;
};

/**
 * functions that we apply before training as well as before and after prediction
 * map dataset trades [{x,y}] into price floats [{x,y}]
 * ships predict, main and alter functions for every currency
 */
const ETLS = {

    [CURRENCY.BTC_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, BTC_EUR_FACTOR);
        },
        main: row => { //before training (is mapped)
           // const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, BTC_EUR_FACTOR);
            row.y = TRADES_TO_ROW_OUTPUT(row.y, ETL_FACTOR);
            return row;
        },
        alter: (outputs, tradeForPrediction) => { //after prediction (is called)
            return OUTPUT_TO_TRADE_PRICES(outputs, ETL_FACTOR, tradeForPrediction);
        }
    },

    [CURRENCY.ETH_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, ETH_EUR_FACTOR);
        },
        main: row => { //before training (is mapped)
           // const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, ETH_EUR_FACTOR);
            row.y = TRADES_TO_ROW_OUTPUT(row.y, ETL_FACTOR);
            return row;
        },
        alter: (outputs, tradeForPrediction) => { //after prediction (is called)
            return OUTPUT_TO_TRADE_PRICES(outputs, ETL_FACTOR, tradeForPrediction);
        }
    },

    [CURRENCY.LTC_EUR]: {
        predict: trades => { //before prediction (is called)
            return TRADES_TO_ROW(trades, LTC_EUR_FACTOR);
        },
        main: row => { //before training (is mapped)
           // const trades = row.x.slice(0);
            row.x = TRADES_TO_ROW(row.x, LTC_EUR_FACTOR);
            row.y = TRADES_TO_ROW_OUTPUT(row.y, ETL_FACTOR);
            return row;
        },
        alter: (outputs, tradeForPrediction) => { //after prediction (is called)
            return OUTPUT_TO_TRADE_PRICES(outputs, ETL_FACTOR, tradeForPrediction);
        }
    },
};

const SUM_LAST_ELEMENTS_IN_ARRAY = (a, c = 3) => {
    
    let sum = 0;
    for(let i = 0; i < c; i++){
        sum += a[a.length - (i+1)];
    }

    return sum;
};

class Coinpusher extends EventEmitter {

    constructor(){
        super();

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
        this.drifts = {};
        this.performanceBuffer = [];

        this.inTraining = false;
        this.performanceSinceStart = 0;
        this.expectedPerformanceSinceStart = 0;
        this.ratingStats = {
            good: 0,
            ok: 0,
            bad: 0
        };
    }

    /**
     * fills the buffers (for real time trade predictions)
     * with data from the dataset of the corresponding coinstream
     * this way we dont have to wait for a while until the buffers fill
     * with new trade events
     */
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

    /**
     * a new incoming trade action (from the subscribed topic of Coinstream.js)
     * evaluate if we are able to predict with the buffered data yet
     * and send a packet (trade and prediction) to all clients
     * @param {*} data 
     */
    _onTrade(data = {}){

        const {currency, trade} = data;
        this._appendBuffer(currency, trade);

        if(this.buffers[currency].length >= DATASET_STEP){
            if(this.nets[currency]){

                if(!ETLS[currency]){
                    return debug("no etl function supports currency", currency);
                }

                //currency->net->prepare->predict->alter
                const predicted = ETLS[currency].alter(this.nets[currency]
                    .predict(ETLS[currency].predict(this.buffers[currency])), trade);

                data = Object.assign({}, data, {predicted});
                const diff = predicted[predicted.length - 1] - predicted[0];
                debug("predicted trade", diff, predicted[0], predicted[predicted.length - 1]);

                this.checkConstantPrediction(currency, trade, predicted);
            }
        }

        this.checkIfDriftReached(currency, trade);

        if(this.ss){
            this.ss.broadcast(data);
        }
    }

    resetPerformanceStats(){
        debug("resetting performance stats");

        this.performanceSinceStart = 0;
        this.expectedPerformanceSinceStart = 0;

        this.ratingStats = {
            "good": 0,
            "ok": 0,
            "bad": 0
        };
    }

    getConstantPredictions(currency){
  
        if(!this.constantPredictions[currency]){
            return [];
        }

        return this.constantPredictions[currency].predictions.slice(0);
    }

    getDrifts(currency){
        
        if(!this.drifts[currency]){
            return [];
        }

        return this.drifts[currency].slice(0);
    }

    getPerformanceInfo(){
        return this.performanceBuffer.slice(0);
    }

    /**
     * every x minutes we want to store a set of predictions
     * this way we can draw a strict line of "contant predictions" on a graph
     * as we'd otherwise have to do this on the client, that receives a lot of
     * predictions on every incoming trade
     * @param {*} currency 
     * @param {*} trade 
     * @param {*} predicted 
     */
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

            this.identifyPossibleTradeAction(currency, trade, newCtrades);
        }
    }

    /**
     * grabs a median of the 20% of the last elements of the prediction
     * calculates the difference between the actual course value on the future value as drift
     * takes the middle of the selection of predictions to pick a timestamp
     * the drift is than added to an array (to check performance later)
     * and send as packet to the clients
     * additionally a drift event is emitted 
     * (that can be used to evaluate buy and sell actions)
     * @param {*} currency 
     * @param {*} trade 
     * @param {*} ctrades 
     */
    identifyPossibleTradeAction(currency, trade, ctrades){

        const currentValue = trade.price;
        const steps = Math.round(OUTPUTS * 0.2); //takes 20% of the predictions
        const futureValue = SUM_LAST_ELEMENTS_IN_ARRAY(ctrades.map(t => t.price), steps) / steps; //median
        const drift = futureValue - currentValue;

        const atSteps = Math.round(steps * 0.5);
        const timestamp = ctrades[ctrades.length - atSteps - 1].timestamp;
        const at = TIMESTAMP_TO_MOMENT(timestamp).format("YYYY-MM-DD HH:mm:ss");

        debug("identified drift", currency, drift, at);

        if(!this.drifts[currency]){
            this.drifts[currency] = [];
        }

        if(this.drifts[currency].length >= MAX_DRIFTS){
            this.drifts[currency].shift();
        }

        const driftObject = {
            currency,
            id: uuid.v4(),
            drift,
            timestamp,
            currentValue,
            futureValue,
            timestampFormatted: at
        };

        this.drifts[currency].push(Object.assign({}, driftObject, {
            processed: false, //will resolve if trade reached with higher timestamp
            resolvedAt: null,
            resolvedWith: null,
            realDrift: null,
            rating: null
        }));

        if(this.ss){
            this.ss.broadcast({
                currency,
                drift: driftObject
            });
        }

        super.emit("drift", driftObject);
    }

    /**
     * rates the draft performance (prediction performance)
     * on a resolved (processed) drift object
     * -1 = bad, 0 = ok, 1 = good
     * @param {*} obj 
     */
    rateDrift(obj){

        if(obj.drift < 0){
            //expected a negative course future
            if(obj.realDrift > 0){
                //but had a positive one
                return -1;
            }
            //had a negative one
            if(obj.realDrift < obj.drift){
                //had an even more negative one
                return 1;
            }
            //had a slight less negative one
            return 0;
        }

        //expected a positive course future
        if(obj.realDrift < 0){
            //but had a negative one
            return -1;
        }
        //had a positive one
        if(obj.realDrift > obj.drift){
            //had an even more positive one
            return 1;
        }
        //had a slight less positive one
        return 0;
    }

    /**
     * is called on every trade
     * checks if a drift has been predicted earlier and if its time has now come (every end of prediction)
     * if a drift is resolved, its performance is rated and its marked as processed
     * the info is emitted and send to all clients
     * and the coinpusher stats are updated
     * @param {*} currency 
     * @param {*} trade 
     */
    checkIfDriftReached(currency, trade){

        if(!this.drifts[currency] || !this.drifts[currency].length){
            return;
        }

        const openDrifts = this.drifts[currency].filter(drift => !drift.processed);
        if(!openDrifts.length){
            return;
        }

        const tradeTime = TIMESTAMP_TO_MOMENT(trade.timestamp);
        openDrifts.forEach(drift => {

            const resolution = TIMESTAMP_TO_MOMENT(drift.timestamp);
            if(!tradeTime.isSameOrAfter(resolution)){
                return; //not yet reached
            }

            debug("reached drift resolution", resolution.format("YYYY-MM-DD HH:mm:ss"), "on", tradeTime.format("YYYY-MM-DD HH:mm:ss"));

            let resolvedObject = null;
            for(let i = this.drifts[currency].length - 1; i >= 0; i--){
                if(this.drifts[currency][i].id === drift.id){

                    this.drifts[currency][i].processed = true; //mark as processed
                    this.drifts[currency][i].resolvedAt = trade.timestamp;
                    this.drifts[currency][i].resolvedWith = trade.price;
                    this.drifts[currency][i].realDrift = trade.price - this.drifts[currency][i].currentValue;
                    this.drifts[currency][i].rating = this.rateDrift(this.drifts[currency][i]);

                    resolvedObject = Object.assign({}, this.drifts[currency][i]);
                    break;
                }
            }

            //keep track of ratings
            switch(resolvedObject.rating){
                case 1: this.ratingStats["good"]++; break;
                case 0: this.ratingStats["ok"]++; break;
                case -1: this.ratingStats["bad"]++; break;
                default: break;
            }

            let netPerformance = 0;
            let driftPerformance = 0;

            //we have no context for our buy and sell actions here
            //which is why we use the rating to generate a context
            //this will result in a trend being shown (but not the actual price performance as we do not know,
            // if the last action was a buy or sell)
            if(resolvedObject.rating >= 0){
                //when the rating was positive
                netPerformance = resolvedObject.drift < 0 ? (resolvedObject.drift * -1) : resolvedObject.drift;
                driftPerformance = resolvedObject.realDrift < 0 ? (resolvedObject.realDrift * -1) : resolvedObject.realDrift;
            } else {
                //when the rating was negative
                netPerformance = resolvedObject.drift > 0 ? (resolvedObject.drift * -1) : resolvedObject.drift;
                driftPerformance = resolvedObject.realDrift > 0 ? (resolvedObject.realDrift * -1) : resolvedObject.realDrift;
            }

            this.expectedPerformanceSinceStart += netPerformance;
            this.performanceSinceStart += driftPerformance;
            
            debug("performance", resolvedObject.rating, netPerformance, driftPerformance,
                "expected", resolvedObject.futureValue, "result", resolvedObject.resolvedWith);

            //cache latest performance infos for new clients
            if(this.performanceBuffer.length >= MAX_PERFORMANCE_BUFFER_SIZE){
                this.performanceBuffer.shift();
            }

            const perfPacket = {
                currency,
                performance: {
                    timestamp: trade.timestamp,
                    expected: this.expectedPerformanceSinceStart,
                    reality: this.performanceSinceStart
                }
            };

            this.performanceBuffer.push(perfPacket);

            if(this.ss){

                this.ss.broadcast({
                    currency,
                    resolved: resolvedObject
                });

                this.ss.broadcast(perfPacket);
            }

            super.emit("resolved", resolvedObject);
        });
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

    /**
     * reads all required neuronal networks from storage
     * (if present)
     */
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

    /**
     * spawns a process (via /lib/jobs/*.js module)
     * that reads the latest full dataset of the currency
     * and builds a neuronal network, which it then serialises
     * and stores on disk, when the process exists successfully
     * we load the stored network from disk
     * (training takes 100% CPU and a lot of memory, that is why we create
     * another thread/process for it)
     * @param {*} currency 
     */
    updateNetworkForCurrency(currency){

        if(!this.css.map(cs => cs.currency).filter(c => c === currency).length){
            return Promise.reject(currency + " not supported for networks on this instance.");
        }

        if(this.inTraining){
            return Promise.reject("this instance is already training a network at the moment.");
        }
        this.inTraining = true;

        const options = {
            stdio: "pipe"
        };
    
        const trainFork = new Promise((resolve, reject) => {
            const trainModule = path.join(__dirname, "./jobs/train.js");
            const child = fork(trainModule, [currency, "--max_old_space_size=8192"], options);

            child.stdout.on("data", data => debug("fork", data.toString("utf8")));
            child.stderr.on("data", data => debug("fork", data.toString("utf8")));

            child.on("close", code => {

                this.inTraining = false; //reset

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

    /**
     * starts a coinstream for the given currency
     * and registers its event with this instance
     * also starts up a webserver with websocketserver
     * that listens for endpoints and socket connections
     * (see /lib/SocketServer.js for more info)
     * @param {*} currency 
     * @param {*} port 
     */
    async start(currency, port){

        //due to the large memory consumption of
        //the networks it is not a good idea to run multiple streams
        //in the same process anymore
        // -> update:
        //with the switch from synaptic to neataptic
        //this has been become obsolete, as we now consume ~ 60 MB per network
        //this has been at about ~ 1.4 GB before
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