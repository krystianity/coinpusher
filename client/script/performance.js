"use strict";

const bitcoinStream = new Stream(null, 3333, true);
const ethereumStream = new Stream(null, 3334, true);
const litecoinStream = new Stream(null, 3335, true);

bitcoinStream.connect();
setTimeout(() => {
    ethereumStream.connect();
    setTimeout(() => {
        litecoinStream.connect();
        }, 2000);
}, 2000);