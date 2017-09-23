"use strict";

class Stream {

    constructor(url = null, port = 3333, performanceOnly = false){

        this.url = url || this.getUrl(port);
        this.performanceOnly = performanceOnly;
        this.connection = null;

        this.plotters = {};
        this.predictionDraw = {};
    }

    resizePlots(){
        Object.keys(this.plotters)
        .map(key => this.plotters[key])
        .forEach(plotter => plotter.resize());
    }

    getUrl(port){
        const location = window.location;
        return location.protocol === "https:" ? "wss:" : "ws:" + "//" 
            + location.hostname + ":" + port;       
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
        
            if(data.trade){
                return this._onTrade(data.currency, data);
            }

            if(data.ctrades){
                return this._onConstPrediction(data.currency, data.ctrades);
            }

            if(data.drift){
                //TODO
                return;
            }

            if(data.resolved){
                //TODO
                return;
            }

            if(data.performance){
                return this._onPerformance(data.currency, data.performance);
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

    _getOrCreatePerformancePlotter(name){

        if(this.plotters[name]){
            return Promise.resolve(this.plotters[name]);
        }

        const plotter = new Plotter(name, name);
        this.plotters[name] = plotter;
        plotter.createDomElement();
        return plotter.createPerformancePlot().then(() => {
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

    //will only return true, if unix timestamp is higher than set for currency
    checkIfPredictionDrawable(currency, unix){
        unix = parseInt(unix);
        
        if(!this.predictionDraw[currency]){
            this.predictionDraw[currency] = unix;
            return true;
        } else {
            if(this.predictionDraw[currency] >= unix){
                return false;
            } else {
                this.predictionDraw[currency] = unix;
                return true;
            }
        }
    }
    
    _onTrade(currency, {trade, predicted}){
        
        if(!trade || this.performanceOnly){
            return;
        }

        let pred = null;
        if(predicted){

            //if a prediction is passed along, we have to map syntetic timestamps
            //as it only comes with y axis values
            const startingTime = this.timestampToMoment(trade.timestamp);
            //const xUnixTimestamps = [];
            let counter = 1;
            pred = {
                x: predicted.map(_ => {
                    //create syntetic timestamps for predictions starting from current trade
                    const timeClone = startingTime.clone();
                    timeClone.add(counter * 5, "seconds");
                    //xUnixTimestamps.push(timeClone.valueOf());
                    counter++;
                    return this.momentToDateTime(timeClone);
                }),
                y: predicted
            };

            /*
            //after a certain amount of trades, every new trade will contain
            //a fixed amount of predictions in the future, to keep the prediction
            //traces in the charts from overwriting each other, we have to filter out
            //timestamps that have already been set
            const removeIndices = [];

            for(let i = 0; i < xUnixTimestamps.length; i++){
                if(!this.checkIfPredictionDrawable(currency, xUnixTimestamps[i])){
                    removeIndices.push(i);
                }
            }

            removeIndices.forEach(index => {
                pred.x.splice(index, 1);
                pred.y.splice(index, 1);
            });

            //check if all predictions are outdated
            if(!pred.x.length){
                pred = null;
            }
            */
        }

        this._getOrCreatePlotter(currency).then(plotter => {

            const datetime = this.convertTimestamp(trade.timestamp);
            //console.log("trade", currency, datetime, trade.price, predicted);

            plotter.updatePlot({
                x: [datetime],
                y: [trade.price]
            }, 
            pred
            ).catch(error => {
                console.error("failed to update plot", error);
            });
        }).catch(error => {
            console.error("failed to create or get plotter", error);
        });
    }

    _onConstPrediction(currency, ctrades){

        if(this.performanceOnly){
            return;
        }

        this._getOrCreatePlotter(currency).then(plotter => {
            plotter.updatePlot(null, null, {
                x: ctrades.map(ctrade => this.convertTimestamp(ctrade.timestamp)),
                y: ctrades.map(ctrade => ctrade.price)
            }).catch(error => {
                console.error("failed to update plot", error);
            });
        });
    }

    _onPerformance(currency, {timestamp, expected, reality}){

        if(!this.performanceOnly){
            return;
        }

        this._getOrCreatePerformancePlotter("performance").then(plotter => {
            
            const data = {
                x: [this.convertTimestamp(timestamp)],
                y: [reality]
            };

            switch(currency){

                case "btceur": 
                    plotter.updatePerformancePlot(data, 0);
                break;

                case "etheur":
                    plotter.updatePerformancePlot(data, 1);
                break;

                case "ltceur":
                    plotter.updatePerformancePlot(data, 2);
                break;

                default:
                    console.warn("unknown currency " + currency);
                break;
            }
        });
    }
}