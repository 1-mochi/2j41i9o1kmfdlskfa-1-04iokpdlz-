const WebSocket = require('ws');

// Your super hard auth key
const SECRET_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`Server running on port ${PORT}`);

// Connect to source WebSocket
const sourceWS = new WebSocket('wss://rrari.rexzy.online'); // or any source

sourceWS.on('open', () => console.log('Connected to source WebSocket'));
sourceWS.on('error', (err) => console.error('Source WS error:', err));
sourceWS.on('close', () => console.log('Source WS disconnected'));

// XOR encryption function (repeating key)
function xorEncrypt(str, key) {
    const keyBytes = Buffer.from(key);
    const data = Buffer.from(str);
    const encrypted = Buffer.alloc(data.length);

    for (let i = 0; i < data.length; i++) {
        encrypted[i] = data[i] ^ keyBytes[i % keyBytes.length];
    }
    return encrypted.toString('base64'); // Send as base64
}

// Random VPS between VPS1–VPS100
function randomVPS() {
    return `VPS${Math.floor(Math.random() * 100) + 1}`;
}

// Transform incoming messages
function transformMessage(msg) {
    try {
        const data = JSON.parse(msg);
        const brain = (data.brainrots && data.brainrots[0]) ? data.brainrots[0].replace(/\s/g,'') : "unknown";
        const generation = (data.generation && data.generation[0]) ? parseFloat(data.generation[0]) * 1000000 : 0;
        const job_id = data.job_id || "";
        const vps = randomVPS();

        return {
            brain: brain,
            generation: generation,
            players: data.players || null,
            job_id: job_id,
            vps: vps
        };
    } catch(e) {
        console.error("Invalid message from source:", e.message);
        return null;
    }
}

// Relay from source WebSocket to authenticated clients
sourceWS.on('message', (msg) => {
    const formatted = transformMessage(msg);
    if (!formatted) return;

    const encrypted = xorEncrypt(JSON.stringify(formatted), SECRET_KEY);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(encrypted);
        }
    });
});

// Handle incoming clients
wss.on('connection', (ws, req) => {
    console.log('Client connected');
    ws.isAuthenticated = false;

    // Auth via JSON
    if (req.url.startsWith('/auth/')) {
        const provided = decodeURIComponent(req.url.split('/auth/')[1]);
        if (provided === SECRET_KEY) {
            ws.isAuthenticated = true;
            ws.send(JSON.stringify({ success: "Authenticated via URL!" }));
        } else {
            ws.send(JSON.stringify({ error: "Unauthorized via URL" }));
            ws.close();
        }
    } else {
        ws.send(JSON.stringify({ info: "Send { auth: 'YOUR_SECRET' } to authenticate" }));
    }

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch(e) {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        if (!ws.isAuthenticated) {
            if (data.auth === SECRET_KEY) {
                ws.isAuthenticated = true;
                ws.send(JSON.stringify({ success: "Authenticated! You will receive encrypted messages." }));
            } else {
                ws.send(JSON.stringify({ error: "Unauthorized. Wrong auth." }));
                return;
            }
        } else {
            // Authenticated clients cannot send anything else (optional)
            ws.send(JSON.stringify({ info: "Server only relays source messages." }));
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
});
