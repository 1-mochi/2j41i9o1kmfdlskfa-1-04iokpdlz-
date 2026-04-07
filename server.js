const WebSocket = require('ws');

const SECRET_KEY = "supersecret123"; // Clients must use this
const PORT = process.env.PORT || 8080;

// Start your WebSocket server
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server running on port ${PORT}`);

// Connect to the source WebSocket
const sourceWS = new WebSocket('wss://rrari.rexzy.online');

sourceWS.on('open', () => console.log('Connected to source WebSocket'));
sourceWS.on('error', (err) => console.error('Source WS error:', err));
sourceWS.on('close', () => console.log('Source WS disconnected'));

// Relay messages from source to authenticated clients
sourceWS.on('message', (msg) => {
    console.log('Message received from source:', msg.toString());

    // Broadcast to authenticated clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(msg.toString());
        }
    });
});

// Handle incoming client connections
wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.isAuthenticated = false;

    // Prompt for authentication
    ws.send(JSON.stringify({ info: "Send { auth: 'YOUR_SECRET' } to authenticate" }));

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        // Check authentication
        if (!ws.isAuthenticated) {
            if (data.auth === SECRET_KEY) {
                ws.isAuthenticated = true;
                ws.send(JSON.stringify({ success: "Authenticated! You will now receive live messages." }));
            } else {
                ws.send(JSON.stringify({ error: "Unauthorized. Provide correct auth." }));
            }
            return;
        }

        // Authenticated clients are allowed to send messages if you want
        // Currently we just ignore client messages, but you could broadcast or handle them
        ws.send(JSON.stringify({ info: "You are authenticated, but this server only relays messages from source." }));
    });

    ws.on('close', () => console.log('Client disconnected'));
});
