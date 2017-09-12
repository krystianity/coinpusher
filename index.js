"use strict";

const Pusher = require("pusher-js/node");
const Bitstamp = require("./lib/Bitstamp.js");

const key = "de504dc5763aeef9ff52";
const currency = "etheur";

const socket = new Pusher(key);

const liveTrades = socket.subscribe(`live_trades_${currency}`);
liveTrades.bind("trade", data => {
    const {amount, price, timestamp, type} = data;
    const cost = amount * price;
    console.log(`${currency} ${amount} ${type ? "sell" : "buy"} for ${parseInt(cost)} €, c: ${price} @ ${timestamp}.`);
});

const bitstamp = new Bitstamp();
bitstamp.ticker(Bitstamp.CURRENCY.ETH_BTC).then(ticker => {
    console.log(ticker.body);
});