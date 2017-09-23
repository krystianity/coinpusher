"use strict";

class Plotter {

    constructor(title, currency, 
            color = "#9370DB", 
            predColor = "#EE6363",
            constPredColor = "#C0DCC0"){

        this.title = title;
        this.currency = currency;
        this.color = color;
        this.predColor = predColor;
        this.constPredColor = constPredColor;
        this.shallow = false;
    }

    createDomElement(){

        if(document.getElementById(this.currency)){
            this.shallow = true;
            return;
        }

        const div = document.createElement("div");
        div.innerHTML = "";
        div.setAttribute("id", this.currency);
        div.setAttribute("class", "plotter-plot");
        document.getElementById("main").appendChild(div);
    }

    _getPredTrace(predData){

        return {
            type: "scatter",
            mode: "lines",
            name: "prediction",
            x: predData.x,
            y: predData.y,
            line: {
                color: this.predColor 
            }
        };
    }

    createPerformancePlot(){

        if(this.shallow){
            return Promise.resolve({});
        }

        const btceur = {
            type: "scatter",
            mode: "lines",
            name: "bitcoin",
            x: [],
            y: [],
            line: {
                color: this.color 
            }
        };

        const etheur = {
            type: "scatter",
            mode: "lines",
            name: "ethereum",
            x: [],
            y: [],
            line: {
                color: this.predColor 
            }
        };

        const ltceur = {
            type: "scatter",
            mode: "lines",
            name: "litecoin",
            x: [],
            y: [],
            line: {
                color: this.constPredColor 
            }
        };

        const plotData = [btceur, etheur, ltceur];
            
        const plotLayout = {
            title: this.title, 
            xaxis: {
                autorange: true, 
                range: [],
                rangeselector: {
                    buttons: [
                        {
                            count: 1, 
                            label: "1m", 
                            step: "minute", 
                            stepmode: "backward"
                        }, 
                        {
                            count: 5, 
                            label: "5m", 
                            step: "minute", 
                            stepmode: "backward"
                        },
                        {
                            count: 10, 
                            label: "10m", 
                            step: "minute", 
                            stepmode: "backward"
                        },
                        {
                            count: 15, 
                            label: "15m",
                            step: "minute", 
                            stepmode: "backward"
                        }, 
                        {
                            count: 1, 
                            label: "1h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 6, 
                            label: "6h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 12, 
                            label: "12h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 1, 
                            label: "1d", 
                            step: "day", 
                            stepmode: "backward"
                        },
                        {
                            count: 3, 
                            label: "3d", 
                            step: "day", 
                            stepmode: "backward"
                        },
                        {
                            step: "all"
                        }
                    ]
                }, 
                rangeslider: {range: []}, 
                type: "date"
            }, 
            yaxis: {
                autorange: true, 
                range: [],
                type: "linear"
            }
        };
            
        return Plotly.newPlot(this.currency, plotData, plotLayout);
    }

    createPlot(streamData = {}, predData = {}){

        if(this.shallow){
            return Promise.resolve({});
        }

        //x: ["2017-02-17", "2017-02-18", "2017-02-19"]
        //y: [3005.12, 3120.5, 4500.1]

        const stream = {
            type: "scatter",
            mode: "lines",
            name: this.currency,
            x: streamData.x,
            y: streamData.y,
            line: {
                color: this.color 
            }
        };

        const constPred = {
            type: "scatter",
            mode: "lines",
            name: "const_pred",
            x: [],
            y: [],
            line: {
                color: this.constPredColor 
            }
        };

        const pred = this._getPredTrace(predData);
        
        const plotData = [stream, constPred, pred];
            
        const plotLayout = {
            title: this.title, 
            xaxis: {
                autorange: true, 
                range: [],
                rangeselector: {
                    buttons: [
                        {
                            count: 1, 
                            label: "1m", 
                            step: "minute", 
                            stepmode: "backward"
                        }, 
                        {
                            count: 5, 
                            label: "5m", 
                            step: "minute", 
                            stepmode: "backward"
                        },
                        {
                            count: 10, 
                            label: "10m", 
                            step: "minute", 
                            stepmode: "backward"
                        },
                        {
                            count: 15, 
                            label: "15m",
                            step: "minute", 
                            stepmode: "backward"
                        }, 
                        {
                            count: 1, 
                            label: "1h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 6, 
                            label: "6h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 12, 
                            label: "12h", 
                            step: "hour", 
                            stepmode: "backward"
                        },
                        {
                            count: 1, 
                            label: "1d", 
                            step: "day", 
                            stepmode: "backward"
                        },
                        {
                            count: 3, 
                            label: "3d", 
                            step: "day", 
                            stepmode: "backward"
                        },
                        {
                            step: "all"
                        }
                    ]
                }, 
                rangeslider: {range: []}, 
                type: "date"
            }, 
            yaxis: {
                autorange: true, 
                range: [],
                type: "linear"
            }
        };
            
        return Plotly.newPlot(this.currency, plotData, plotLayout);
    }

    updatePlot(newStreamData = null, newPredData = null, constPredData = null){

        if(newStreamData){
            Plotly.extendTraces(this.currency, {
                x: [newStreamData.x],
                y: [newStreamData.y]
            }, [0]);
        }
        
        if(constPredData){
            Plotly.extendTraces(this.currency, {
                x: [constPredData.x],
                y: [constPredData.y]
            }, [1]);
        }
        
        if(newPredData){
            Plotly.deleteTraces(this.currency, [2]);
            Plotly.addTraces(this.currency, this._getPredTrace(newPredData));
        }
        
        return Promise.resolve();
    }

    updatePerformancePlot(data, index){
        return Plotly.extendTraces(this.currency, {
            x: [data.x],
            y: [data.y]
        }, [index]);
    }

    resize(){
        Plotly.Plots.resize(document.getElementById(this.currency));
    }
}