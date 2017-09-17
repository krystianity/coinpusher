"use strict";

class Stream {

    constructor(url = "ws://localhost:3333/"){
        this.url = url;
        this.connection = null;
        this.plotters = {};
    }

    connect(){

        console.log("connecting..");
        this.connection = new WebSocket(this.url);
        
        this.connection.onopen = () => {
            console.log("connected.");
            this.connection.send(JSON.stringify({message: "hi"}));
        };
        
        this.connection.onerror = error => {
            console.error(error);
        };
        
        this.connection.onmessage = message => {
            
            let data = message.data;
            try {
                data = JSON.parse(data);
            } catch(error){
                return console.error("failed to parse message", data, error);
            }
            
            if(data.collected){
                return this._onStep(data.currency, data);
            }
        
            if(data.trade){
                return this._onTrade(data.currency, data);
            }
        
            console.warn("unknown message", data);
        };
    }

    _getOrCreatePlotter(currency){

        if(this.plotters[currency]){
            return Promise.resolve(this.plotters[currency]);
        }

        const plotter = new Plotter(currency, currency);
        this.plotters[currency] = plotter;
        plotter.createDomElement();
        return plotter.createPlot({
            x: [],
            y: []
        }, {
            x: [],
            y: []
        }).then(() => {
            return plotter;
        });
    }

    timestampToMoment(unix){
        const punix = parseInt(unix);
        return moment.unix(punix);
    }

    momentToDateTime(m){
        return m.format("YYYY-MM-DD HH:mm:ss");
    }

    convertTimestamp(unix){
        return this.momentToDateTime(this.timestampToMoment(unix));
    }

    _onStep(currency, {collected, predicted}){
        console.log("got step for", currency, predicted);
    }
    
    _onTrade(currency, {trade, predicted}){
        
        if(!trade){
            return;
        }

        let pred = null;
        if(predicted){
            const startingTime = this.timestampToMoment(trade.timestamp);
            let counter = 1;
            pred = {
                x: predicted.map(_ => {
                    //create syntetic timestamps for predictions starting from current trade
                    const timeClone = startingTime.clone();
                    timeClone.add(counter * 5, "seconds");
                    counter++;
                    return this.momentToDateTime(timeClone);
                }),
                y: predicted.map(p => p * 1000)
            };
        }

        this._getOrCreatePlotter(currency).then(plotter => {

            const datetime = this.convertTimestamp(trade.timestamp);
            console.log("trade", currency, datetime, trade.price, predicted);
            
            plotter.updatePlot({
                x: [datetime],
                y: [trade.price]
            }, 
            pred
            ).catch(error => {
                console.error("failed to update plot", error);
            })
        }).catch(error => {
            console.error("failed to create or get plotter", error);
        })
    }
}