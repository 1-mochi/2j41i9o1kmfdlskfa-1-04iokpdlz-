const WebSocket = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

console.log(`Server running on port ${port}`);

wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send the test message immediately on connection
    const testMessage = {
        auth: "supersecret123",
        name: "Cigno Fulgoro,Snailo Clovero,Granny",
        generation: "200,111,27",
        players: "7/8",
        jobid: "af713949-3dc6-47ee-bd80-0c19e672b6ba"
    };

    ws.send(JSON.stringify(testMessage));

    ws.on('close', () => console.log('Client disconnected'));
});
