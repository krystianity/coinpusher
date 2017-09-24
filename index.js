"use strict";

const {Coinpusher} = require("./lib/Coinpusher.js");

if (require.main === module) {
    
    const coins = process.argv[2];
    
    const cp = new Coinpusher();
    
    switch(coins){
    
        case "bitcoin": 
            cp.startForBitcoin();
        break;
    
        case "ethereum":
            cp.startForEthereum();
        break;
    
        case "litecoin":
            cp.startForLitecoin();
        break;
    
        default:
            console.error("unknown coin type: " + coins);
        break;
    }

} else {
    module.exports = Coinpusher;
}