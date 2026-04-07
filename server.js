const WebSocket = require('ws');
const crypto = require('crypto');

// ==================== STRONG SECRET KEY (DO NOT SHARE) ====================
// Generate your own with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const SECRET_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";

const SALT = "RyHub-Salt-2026-v2-x7K9pQ2mZ8vL4nT6wR";
const PORT = process.env.PORT || 8080;

// Derive a strong 32-byte key using PBKDF2
const ENCRYPTION_KEY = crypto.pbkdf2Sync(SECRET_KEY, SALT, 100000, 32, 'sha512');

const wss = new WebSocket.Server({ port: PORT });



// Connect to source WebSocket
const sourceWS = new WebSocket('wss://rrari.rexzy.online');

sourceWS.on('open', () => console.log('✅ Connected to source WebSocket'));
sourceWS.on('error', (err) => console.error('❌ Source WS error:', err));
sourceWS.on('close', () => console.log('⚠️ Source WS disconnected'));

// Strong AES-256-GCM encryption
function encrypt(data) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        
        let encrypted = cipher.update(JSON.stringify(data), 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();
        const combined = Buffer.concat([iv, encrypted, authTag]);
        
        return combined.toString('base64');
    } catch (e) {
        console.error("Encryption failed:", e.message);
        return null;
    }
}

// AES-256-GCM decryption (for clients)
function decrypt(encryptedBase64) {
    try {
        const combined = Buffer.from(encryptedBase64, 'base64');
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12, -16);
        const authTag = combined.slice(-16);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return JSON.parse(decrypted.toString('utf8'));
    } catch (e) {
        console.error("Decryption failed:", e.message);
        return null;
    }
}

// Random VPS generator
function randomVPS() {
    return `VPS${Math.floor(Math.random() * 100) + 1}`;
}

// Transform source message to match exact format you want
function transformMessage(msg) {
    try {
        const data = JSON.parse(msg);
        const brain = (data.brainrots && data.brainrots[0]) 
            ? data.brainrots[0].replace(/\s/g, '') 
            : "unknown";
            
        const genValue = (data.generation && data.generation[0]) 
            ? parseFloat(data.generation[0]) 
            : 0;

        // Convert to the exact format you requested
        return {
            brainrots: [brain],
            generation: [genValue.toString()],   // as string like "68"
            players: data.players || null,
            job_id: data.job_id || "",
            vps: randomVPS()
            // ts removed because your example doesn't have it
        };
    } catch (e) {
        console.error("Invalid message from source:", e.message);
        return null;
    }
}

// Relay encrypted data
sourceWS.on('message', (msg) => {
    const formatted = transformMessage(msg);
    if (!formatted) return;

    const encrypted = encrypt(formatted);
    if (!encrypted) return;

    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(encrypted);
            count++;
        }
    });

    if (count > 0) console.log(`📤 Encrypted update sent to ${count} client(s)`);
});

// Client connection handler
wss.on('connection', (ws, req) => {
    console.log('📡 Client connected');
    ws.isAuthenticated = false;

    // URL auth support
    if (req.url && req.url.startsWith('/auth/')) {
        const provided = decodeURIComponent(req.url.split('/auth/')[1]);
        if (provided === SECRET_KEY) {
            ws.isAuthenticated = true;
            ws.send(JSON.stringify({ 
                success: "✅ Authenticated via URL (AES-256-GCM)",
                note: ""
            }));
            console.log('🔑 Client authenticated (URL)');
            return;
        } else {
            ws.send(JSON.stringify({ error: "❌ Unauthorized" }));
            ws.close(1008, "Bad key");
            return;
        }
    }

    ws.send(JSON.stringify({ 
        info: "🔒 Send JSON: {\"auth\": \"YOUR_SECRET_KEY_HERE\"} to authenticate",
        encryption: "AES-256-GCM"
    }));

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
                ws.send(JSON.stringify({ 
                    success: "✅ Authenticated successfully!",
                    message: "cool"
                }));
                console.log('🔑 Client authenticated via message');
            } else {
                ws.send(JSON.stringify({ error: "❌ Wrong secret key" }));
                console.log('🚫 Failed authentication attempt');
            }
        } else {
            ws.send(JSON.stringify({ info: "tuff?" }));
        }
    });

    ws.on('close', () => console.log('👋 Client disconnected'));
});

