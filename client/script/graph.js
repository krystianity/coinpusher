const connection = new WebSocket("ws://localhost:3333/");

connection.onopen = () => {
    console.log("connected.");
    connection.send(JSON.stringify({message: "hi"}));
};

connection.onerror = error => {
    console.error(error);
};

connection.onmessage = message => {
    
    let data = message.data;
    try {
        data = JSON.parse(data);
    } catch(error){
        return console.error("failed to parse message", data, error);
    }
    
    if(data.collected){
        return onStep(data.currency, data.collected);
    }

    if(data.trade){
        return onTrade(data.currency, data.trade);
    }

    console.warn("unknown message", data);
};

const onStep = (currency, data) => {
    console.log("got step for", currency, data.predicted);
};

const onTrade = (currency, data) => {
    console.log(data);
    console.log("got trade for", currency, data.predicted);
};