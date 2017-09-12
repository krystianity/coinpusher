"use strict";

const Promise = require("bluebird");
const request = require("request");

// 600 requests max per 10 minutes
const MAX_CALL_WINDOW = 60 * 1000; // 10 minutes
const MAX_CALLS_PER_WINDOW = 60;

class Bitstamp {

    constructor(base = "https://www.bitstamp.net/api/v2"){
        this.base = base;
        this.totalCallsMade = 0;
        this.callsInLastMinute = 0;

        this._intv = setInterval(() => {
            this.callsInLastMinute = 0;
        }, MAX_CALL_WINDOW);
    }

    _getUrl(endpoint = ""){
        return `${this.base}/${endpoint}`;
    }

    _getOptions(endpoint = "", body = {}, method = "GET"){
        return {
            method,
            url: this._getUrl(endpoint),
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            body: typeof body !== "string" ? JSON.stringify(body) : body
        };
    }

    call(endpoint, body, method){
        return new Promise((resolve, reject) => {

            this.totalCallsMade++;
            this.callsInLastMinute++;

            if(this.callsInLastMinute >= MAX_CALLS_PER_WINDOW){
                return reject(new Error(`Must not exceed ${MAX_CALLS_PER_WINDOW} calls per ${MAX_CALL_WINDOW} ms.`));
            }

            request(this._getOptions(endpoint, body, method), (error, response, body) => {

                if(error){
                    return reject(error);
                }

                try {
                    body = JSON.parse(body);
                } catch(error){
                    //empty
                }

                resolve({
                    status: response.statusCode,
                    headers: response.headers,
                    body
                });
            });
        });
    }
    
    /* API */

    ticker(currency){
        return this.call(`ticker/${currency}`, "", "GET");
    }
}

Bitstamp.CURRENCY = {
    BTC_EUR: "btceur",
    EUR_USD: "eurusd",
    XRP_USD: "xrpusd",
    XRP_EUR: "xrpeur",
    XRP_BTC: "xrpbtc",
    LTC_USD: "ltcusd",
    LTC_EUR: "ltceur",
    LTC_BTC: "ltcbtc",
    ETH_USD: "ethusd",
    ETH_EUR: "etheur",
    ETH_BTC: "ethbtc"
};

module.exports = Bitstamp;