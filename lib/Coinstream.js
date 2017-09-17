"use strict";

const Promise = require("bluebird");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const {CURRENCY} = require("node-bitstamp");
const debug = require("debug")("coinpusher:coinstream");

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

        this.count = 0;
        this.collected = [];
        this.dataset = null;
        this.lastSize = -1;
        this.stream = null;
        this.lastTrade = null;
        this._intv = null;
    }

    getTradesInStream(){
        let trades = 0;
        this.dataset.forEach(row => {
            trades += row.x.length;
            trades += row.y.length;
        });
        return trades;
    }

    getStats(){
        return {
            currency: this.currency,
            filePath: this.getStreamFile(),
            count: this.count,
            collected: this.collected,
            datasetSize: this.dataset.length,
            totalTradesInStream: this.getTradesInStream(),
            lastTrade: this.lastTrade
        };
    }

    getStreamFile(){
        return path.join(this.streamDir, `${this.currency}.fs`);
    }

    loadStreamFromDisk(){

        //create if not exists (sync)
        if(!fs.existsSync(this.getStreamFile())){
            fs.writeFileSync(this.getStreamFile(), "[]", "utf8");
        }

        return new Promise((resolve, reject) => {
            fs.readFile(this.getStreamFile(), (error, data) => {

                if(error){
                    return reject(error);
                }

                data = Buffer.isBuffer(data) ? data.toString("utf8") : data;
                const size = Buffer.byteLength(data, "utf8") / 1000;
                debug("stream loaded", this.currency, size, "kb");
                
                try {
                    data = JSON.parse(data);
                } catch(error){
                    return reject(error);
                }
                
                resolve(data);
            });
        });
    }

    startStream(){

        debug("starting coinstream", this.currency);
        const topic = this.tickerStream.subscribe(this.currency);
        this.tickerStream.on(topic, trade => {
        
            const {type, price, amount, timestamp, cost} = trade;
        
            this.collected.push({
                type,
                price,
                amount,
                timestamp
            });
        
            this.lastTrade = new Date().toISOString();
            debug("trade", this.currency, cost, type);
            super.emit("trade", {
                currency: this.currency,
                trade
            });

            this.count++;
            if(this.count >= this.step){
                this.count = 0;
                this._onStepReach(this.collected.slice(0)); //pass copy
                this.collected = [];
            }
        });

        this._intv = setInterval(() => {
            
            if(this.lastSize === this.dataset.length){
                return;
            }

            this.lastSize = this.dataset.length;
        
            debug("storing stream", this.currency, this.dataset.length);
            fs.writeFile(this.getStreamFile(), JSON.stringify(this.dataset), error => {
        
                if(error){
                    return console.error(error);
                }
        
                debug("stored stream", this.currency);
            });
        }, 12 * 1000);
    }

    _onStepReach(collected){

        debug("step reached", this.currency);
        
        const x = [];
        const y = [];
    
        for(let i = 0; i < collected.length; i++){

            if(!collected[i]){
                return console.error("collected contains null fields", this.currency, i, collected);
            }

            if(i < collected.length / 2){
                x.push(collected[i]);
            } else {
                y.push(collected[i]);
            }
        }

        const _collected = {
            x,
            y
        };

        super.emit("step", {
            currency: this.currency,
            collected: _collected
        });
        
        this.dataset.push(_collected);
    }

    async start(){

        this.dataset = await this.loadStreamFromDisk();
        this.lastSize = this.dataset.length;

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