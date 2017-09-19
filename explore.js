"use strict";

const {CURRENCY} = require("node-bitstamp");
const Coinstream = require("./lib/Coinstream.js");

const stream = new Coinstream({
    tickerStream: null,
    currency: CURRENCY.ETH_EUR
});

stream.loadStreamFromDisk().then(trades => {

    let lowest = trades[0];
    let highest = trades[0];
    
    trades.forEach(trade => {

        if(highest.amount < trade.amount){
            highest = trade;
        }

        if(lowest.amount > trade.amount){
            lowest = trade;
        }
    });

    console.log(lowest);
    console.log();
    console.log(highest);
});