"use strict";

const bitcoinStream = new Stream(null, 3333, true);
const ethereumStream = new Stream(null, 3334, true);
const litecoinStream = new Stream(null, 3335, true);

bitcoinStream.connect();
ethereumStream.connect();
litecoinStream.connect();

window.onresize = () => {
    //bitcoinStream.resizePlots();
    //ethereumStream.resizePlots();
    litecoinStream.resizePlots();
};