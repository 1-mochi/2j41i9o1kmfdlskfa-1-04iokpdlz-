const WebSocket = require('ws');

// IMPORTANT: use Render's port
const port = process.env.PORT || 8080;

// Create WebSocket server
const wss = new WebSocket.Server({ port });

console.log(`Server running on port ${port}`);

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        console.log('Received:', message.toString());

        // Send reply back
        ws.send('Hello from server!');
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (err) => {
        console.error('Error:', err);
    });
});