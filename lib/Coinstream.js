"use strict";

const Promise = require("bluebird");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const {CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:coinstream");

const DELIMITER = "||";
const MAX_DATASET_SIZE = 1e5;

class Coinstream extends EventEmitter {

    constructor(opts = {}){
        super();

        const {
            currency,
            step,
            streamDir,
            tickerStream
        } = opts;

        this.currency = currency || CURRENCY.ETH_EUR;
        this.step = step || 20;
        this.streamDir = streamDir || path.join(__dirname, "./../streams");
        this.tickerStream = tickerStream;

        this.collected = [];
        this.dataset = null; //TODO dont hold the full dataset in memory
        this.stream = null;
        this.lastTrade = null;
        this._intv = null;
    }

    getStats(){
        return {
            currency: this.currency,
            filePath: this.getStreamFile(),
            count: this.collected.length,
            collected: this.collected,
            datasetSize: this.dataset.length,
            lastTrade: this.lastTrade,
            latestTrades: this.getLatestTrades(3)
        };
    }

    getLatestTrades(count = 10){

        if(!this.dataset || !this.dataset.length){
            return [];
        }

        let trades = [];

        if(this.dataset.length <= count){
            trades = this.dataset.slice(0);
        } else {
            for(let i = this.dataset.length - 1; i > (this.dataset.length - 1 - count); i--){
                trades.push(this.dataset[i]);
            }
            trades.reverse();
        }

        return trades;
    }

    getStreamFile(){
        return path.join(this.streamDir, `${this.currency}.fs`);
    }

    /**
     * reads the dataset file from disk
     * since we run append only on files, we use a proprietary format
     * where we simply JSON serialise each trade and separate them with ||
     * when appending to the file, therefore we have to read the file,
     * split for || and json parse single handedly as we append to an array
     * to get a list of trades back into memory
     * @param {*} full 
     */
    loadStreamFromDisk(full = true){

        //create if not exists (sync)
        if(!fs.existsSync(this.getStreamFile())){
            fs.writeFileSync(this.getStreamFile(), "", "utf8");
            debug("fresh stream created", this.currency);
            return Promise.resolve([]);
        }

        return new Promise((resolve, reject) => {
            fs.readFile(this.getStreamFile(), (error, data) => {

                if(error){
                    return reject(error);
                }

                data = Buffer.isBuffer(data) ? data.toString("utf8") : data;
                const size = Buffer.byteLength(data, "utf8") / 1000;

                const dataset = [];
                let i = 0;
                const split = data.split(DELIMITER);

                if(!split || !split.length || split.length === 1){
                    debug("stream file is empty", this.currency);
                    return resolve([]);
                }

                split.forEach(part => {

                    i++;

                    if(part === "" || part === " "){
                        return; //skip spaces
                    }

                    if(!full && dataset.length >= MAX_DATASET_SIZE){
                        dataset.shift();
                    }

                    try {
                        const dpart = JSON.parse(part);
                        if(typeof dpart === "object" && dpart){
                            dataset.push(dpart);
                        } else {
                            debug("bad part in stream file", i, part);
                        }
                    } catch(error){
                        debug("failed to parse part in stream file", i, part, error);
                    }
                })
                
                debug("stream loaded", this.currency, size, "kb", dataset.length);
                resolve(dataset);
            });
        });
    }

    /**
     * subscribes to pusher stream
     * writes collected events to file (append mode) in an interval
     */
    startStream(){

        debug("starting coinstream", this.currency);
        const topic = this.tickerStream.subscribe(this.currency);

        //it actually very easy to adapt this to any other kind of datasource
        //the only important thing is that it emits events with an object
        //that at least contains {price, timestamp} where price is a float
        //and timestamp is a unix seconds timestamp
        this.tickerStream.on(topic, trade => {
        
            const {type, cost} = trade;
        
            //push to collected so that it is stored to disk later
            this.collected.push(trade);

            //push to dataset so that fresh data is available in memory

            if(this.dataset.length >= MAX_DATASET_SIZE){
                this.dataset.shift();
            }

            this.dataset.push(trade);
        
            this.lastTrade = new Date().toISOString();
            debug("trade", this.currency, cost, type);
            super.emit("trade", {
                currency: this.currency,
                trade
            });
        });

        this._intv = setInterval(() => {
            
            if(this.collected.length < this.step){
                return;
            }

            debug("storing latest collection of stream", this.currency, this.collected.length);
            const transfer = this.collected.slice(0);
            this.collected = []; //reset

            let appendData = "";
            transfer.forEach(trade => {
                appendData += JSON.stringify(trade) + DELIMITER;
            });
        
            fs.appendFile(this.getStreamFile(), appendData, error => {
        
                if(error){
                    return console.error(error);
                }
        
                debug("successfully appended stream", this.currency);
            });
        }, 3000);
    }

    async start(){
        this.dataset = await this.loadStreamFromDisk(false);
        this.startStream();
        return true;
    }

    close(){

        debug("closing", this.currency);
        if(this._intv){
            clearInterval(this._intv);
        }
    }
}

module.exports = Coinstream;