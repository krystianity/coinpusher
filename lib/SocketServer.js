"use strict";

const Promise = require("bluebird");
const EventEmitter = require("events");
const path = require("path");
const WebSocket = require("uws");
const WebSocketServer = WebSocket.Server;
const http = require("http");
const express = require("express");
const debug = require("debug")("coinpusher:socketserver");

const MAX_PUSH_ON_CON_COUNT = 64; 

function heartbeat() {
    this.isAlive = true;
}

class SocketServer extends EventEmitter {

    constructor(config = null, coinpusher = null){
        super();

        this.coinpusher = coinpusher;
        this.config = config || { port: 3000 };
        this.wss = null;
        this._hbintv = null;
        this.server = null;
    }

    _registerHttpEndpoints(app){

        app.get("/", (req, res) => {
            res.status(200).json({
                "/graph": `http://localhost:${this.config.port}/graph`,
                "/graph/performance.html": `http://localhost:${this.config.port}/graph/performance.html`,
                "/coinstreams": `http://localhost:${this.config.port}/coinstreams`,
                "/currencies": `http://localhost:${this.config.port}/currencies`,
                "/reset-stats": `http://localhost:${this.config.port}/reset-stats`,
                "/stats": `http://localhost:${this.config.port}/stats`,
                "/nn/train/:currency": `http://localhost:${this.config.port}/nn/train/etheur`,
                "/nn/status": `http://localhost:${this.config.port}/nn/status`
            });
        });

        app.use("/graph", express.static(path.join(__dirname, "../client")));

        app.get("/coinstreams", (req, res) => {
            res.status(200).json(this.coinpusher.css.map(cs => {
                return Object.assign(cs.getStats(), {
                    ctrades: this.coinpusher.getConstantPredictions(cs.currency),
                    drifts: this.coinpusher.getDrifts(cs.currency)
                });
            }));
        });

        app.get("/stats", (req, res) => {
            res.status(200).json({
                performanceSinceStart: this.coinpusher.performanceSinceStart,
                expectedPerformanceSinceStart: this.coinpusher.expectedPerformanceSinceStart,
                ratings: this.coinpusher.ratingStats
            });
        });

        app.get("/reset-stats", (req, res) => {
            this.coinpusher.resetPerformanceStats();
            res.status(200).json({message: "resetted"});
        });

        app.get("/currencies", (req, res) => {
            res.status(200).json(this.coinpusher.getAvailableCurrencies());
        });

        app.get("/nn/train/:currency", (req, res) => {
            this.coinpusher.updateNetworkForCurrency(req.params.currency).then(result => {
                if(result){
                    res.status(200).json({message: "trained"});
                } else {
                    res.status(501).json({message: "failed"});
                }
            }).catch(error => {
                res.status(500).json({message: "failed", reason: error.message});
            });
        });

        app.get("/nn/status", (req, res) => {
            res.status(200).json(this.coinpusher.getNetworkStats());
        });
    }

    _pushLatestTrades(socket){
        this.coinpusher.css.forEach(cs => {
            
            if(!cs || !cs.dataset || !cs.dataset.length){
                return;
            }

            const trades = cs.getLatestTrades(MAX_PUSH_ON_CON_COUNT);

            debug("pushing latest trades", cs.currency, trades.length);
            socket.send(JSON.stringify({
                currency: cs.currency,
                trade: trades[0]
            }));

            //await creation of graph in frontend
            setTimeout(() => {
                trades.forEach(trade => {
                    socket.send(JSON.stringify({
                        currency: cs.currency,
                        trade
                    }));
                });
            }, 100);
        });
    }

    _pushLatestConstPredictions(socket){
        this.coinpusher.css.forEach(cs => {
            
            //no need to send predictions if no trade data is available
            if(!cs || !cs.dataset || !cs.dataset.length){
                return;
            }

            const ctrades = this.coinpusher.getConstantPredictions(cs.currency);

            if(!ctrades.length){
                return debug("no cpredictions loaded yet.", cs.currency);
            }

            debug("pushing latest constant predictions", cs.currency, ctrades.length);
            socket.send(JSON.stringify({
                currency: cs.currency,
                ctrades
            }));
        });
    }

    _pushLatestPerformanceBuffer(socket){
        const pb = this.coinpusher.getPerformanceInfo();
        
        if(!pb || !pb.length){
            return debug("no performance info loaded yet.");
        }

        debug("pushing performance info", pb.length);
        pb.forEach(info => {
            socket.send(JSON.stringify(info));
        });
    }

    start(){
        return new Promise(resolve => {

            const app = express();

            app.use((req, res, next) => {
                debug("express hit", req.url);
                next();
            });

            this._registerHttpEndpoints(app);

            const server = http.createServer(app);

            debug("starting", this.config);
            this.wss = new WebSocketServer(Object.assign({}, this.config, {server}));

            this._hbintv = setInterval(() => {

                if(!this.wss){
                    return;
                }

                this.wss.clients.forEach(socket => {

                    if (socket.isAlive === false){
                        debug("kicking socket for inactivity");
                        return socket.terminate();
                    } 
                
                    socket.isAlive = false;
                    socket.ping("", false, true);
                });
            }, 3000);
            
            this.wss.on("connection", (socket, req) => {

                debug("new client");

                socket.isAlive = true;
                socket.on("pong", heartbeat);
                super.emit("new", socket);

                socket.on("message", message => {
                    debug("client sent data", message);
                    super.emit("message", message);    
                });

                socket.on("close", () => {
                    debug("client left");
                    super.emit("gone", socket);
                });

                this._pushLatestTrades(socket);
                this._pushLatestPerformanceBuffer(socket);

                setTimeout(() => {
                    this._pushLatestConstPredictions(socket);
                }, 5000);
            });

            this.server = server.listen(this.config.port, () => {
                resolve();
            });
        });
    }

    broadcast(message){
        message = typeof message !== "string" ? JSON.stringify(message) : message;
        this.wss.clients.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(message)
            }
        });
    }

    close(){

        if(this._hbintv){
            clearInterval(this._hbintv);
        }

        if(this.wss){
            this.wss.close();
        }

        if(this.server){
            this.server.close();
        }
    }

}

module.exports = SocketServer;