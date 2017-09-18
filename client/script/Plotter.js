"use strict";

class Plotter {

    constructor(title, currency, color = "#9370DB", predColor = "#EE6363"){
        this.title = title;
        this.currency = currency;
        this.color = color;
        this.predColor = predColor;
    }

    createDomElement(){
        const div = document.createElement("div");
        div.innerHTML = "";
        div.setAttribute("id", this.currency);
        div.setAttribute("class", "plotter-plot");
        document.getElementById("main").appendChild(div);
    }

    createPlot(streamData = {}, predData = {}){

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

        const pred = {
            type: "scatter",
            mode: "lines",
            name: "prediction",
            x: predData.x,
            y: predData.y,
            line: {
                color: this.predColor 
            }
        };
        
        const plotData = [stream, pred];
            
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

    updatePlot(newStreamData = null, newPredData = null){

        const promises = [];

        if(newStreamData){
            promises.push(Plotly.extendTraces(this.currency, {
                x: [newStreamData.x],
                y: [newStreamData.y]
            }, [0]));
        }
            
        if(newPredData){
            promises.push(Plotly.extendTraces(this.currency, {
                x: [newPredData.x],
                y: [newPredData.y]
            }, [1]));
        }
        
        return Promise.all(promises);
    }
}