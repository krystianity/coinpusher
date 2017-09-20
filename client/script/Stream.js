"use strict";

class Stream {

    constructor(url = null, port = 3333){

        this.url = url || this.getUrl(port);
        this.connection = null;

        this.plotters = {};
        this.predictionDraw = {};

        window.onresize = () => {
            Object.keys(this.plotters)
                .map(key => this.plotters[key])
                .forEach(plotter => plotter.resize());
        };
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
                return this.onConstPrediction(data.currency, data.ctrades);
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
        
        if(!trade){
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

    onConstPrediction(currency, ctrades){
        this._getOrCreatePlotter(currency).then(plotter => {
            plotter.updatePlot(null, null, {
                x: ctrades.map(ctrade => this.convertTimestamp(ctrade.timestamp)),
                y: ctrades.map(ctrade => ctrade.price)
            }).catch(error => {
                console.error("failed to update plot", error);
            });
        });
    }
}