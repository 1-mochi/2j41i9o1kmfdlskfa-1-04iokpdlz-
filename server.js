const WebSocket = require('ws');
const crypto = require('crypto');
const SECRET_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF"; // receiver key
const SENDER_AUTH_KEY = "LDJFSIJ3I4J2IO1111"; // forwarder key
const PORT = process.env.PORT || 8080;
const UPSTREAM_WS_URL = process.env.UPSTREAM_WS_URL || 'ws://141.11.243.16:5894';

const wss = new WebSocket.Server({ port: PORT });
console.log(`✅ WS relay running on port ${PORT}`);

function sha256Hex(plaintext) {
    return crypto.createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
}

/** Replace plaintext SERVERID with its SHA-256 hex digest before relaying. */
function withServerIdHashed(payload) {
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }
    const out = { ...payload };
    if (Object.prototype.hasOwnProperty.call(out, 'SERVERID')) {
        out.SERVERID = sha256Hex(out.SERVERID);
    }
    return out;
}

function connectUpstreamRelay() {
    const upstream = new WebSocket(UPSTREAM_WS_URL);

    upstream.on('open', () => {
        console.log(`🔗 Upstream connected: ${UPSTREAM_WS_URL}`);
    });

    upstream.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg.toString());
        } catch {
            console.warn('⚠️ Upstream non-JSON message skipped');
            return;
        }
        broadcastToReceivers(data);
        console.log('📨 Relayed message from upstream');
    });

    upstream.on('close', (code, reason) => {
        const r = reason && reason.toString();
        console.log(`🔌 Upstream closed (${code})${r ? `: ${r}` : ''} — reconnecting in 3s`);
        setTimeout(connectUpstreamRelay, 3000);
    });

    upstream.on('error', (err) => {
        console.error('❌ Upstream error:', err.message);
    });
}

connectUpstreamRelay();

function normalizeAuthFromUrl(rawUrl) {
    if (!rawUrl || !rawUrl.startsWith('/auth/')) return "";
    const noQuery = rawUrl.split('?')[0];
    const tokenPart = noQuery.slice('/auth/'.length).replace(/\/+$/, '');
    try {
        return decodeURIComponent(tokenPart);
    } catch {
        return tokenPart;
    }
}

function broadcastToReceivers(formatted) {
    const payload = withServerIdHashed(formatted);
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated && client.role === "receiver") {
            client.send(JSON.stringify(payload));
            count++;
        }
    });
    console.log(`📤 Broadcast -> ${count} receiver(s)`);
}

wss.on('connection', (ws, req) => {
    console.log('📡 Client connected');
    ws.isAuthenticated = false;
    ws.role = null;

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        if (!ws.isAuthenticated) {
            if (data.auth === SECRET_KEY) {
                ws.isAuthenticated = true;
                ws.role = "receiver";
                ws.send(JSON.stringify({ 
                    success: "✅ Authenticated successfully!",
                    role: ws.role
                }));
                console.log('🔑 Receiver authenticated via message');
                return;
            }
            if (data.auth === SENDER_AUTH_KEY) {
                ws.isAuthenticated = true;
                ws.role = "sender";
                ws.send(JSON.stringify({ 
                    success: "✅ Authenticated successfully!",
                    role: ws.role
                }));
                console.log('🔑 Sender authenticated via message');
                return;
            }
            ws.send(JSON.stringify({ error: "❌ Wrong auth key" }));
            console.log('🚫 Failed authentication attempt');
            return;
        }

        if (ws.role === "sender") {
            // Sender clients publish payloads; server relays to receivers only.
            console.log('📨 Sender message received');
            broadcastToReceivers(data);
            return;
        }

        ws.send(JSON.stringify({ info: "✅ receiver connected" }));
    });

    ws.on('close', () => console.log('👋 Client disconnected'));

    if (req.url && req.url.startsWith('/auth/')) {
        const provided = normalizeAuthFromUrl(req.url);
        if (provided === SECRET_KEY) {
            ws.isAuthenticated = true;
            ws.role = "receiver";
            ws.send(JSON.stringify({ 
                success: "✅ Receiver authenticated via URL",
                role: ws.role
            }));
            console.log('🔑 Receiver authenticated (URL)');
            return;
        }
        if (provided === SENDER_AUTH_KEY) {
            ws.isAuthenticated = true;
            ws.role = "sender";
            ws.send(JSON.stringify({ 
                success: "✅ Sender authenticated via URL",
                role: ws.role
            }));
            console.log('🔑 Sender authenticated (URL)');
            return;
        }
        ws.send(JSON.stringify({ error: "❌ Unauthorized" }));
        ws.close(1008, "Bad key");
        return;
    }

    ws.send(JSON.stringify({ 
        info: "🔒 Send JSON: {\"auth\": \"YOUR_SECRET_KEY_HERE\"} to authenticate",
        roles: "receiver (SECRET_KEY) or sender (SENDER_AUTH_KEY)"
    }));
});

