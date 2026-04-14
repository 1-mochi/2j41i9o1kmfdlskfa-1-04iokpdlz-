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
const sourceWS = new WebSocket('wss://ws.vanishnotifier.org/recent');

sourceWS.on('open', () => console.log('✅ Connected to source WebSocket'));
sourceWS.on('error', (err) => console.error('❌ Source WS error:', err));
sourceWS.on('close', () => console.log('⚠️ Source WS disconnected'));

// AES-256-GCM encryption for job_id only
function encryptJobId(jobId) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        
        let encrypted = cipher.update(String(jobId ?? ""), 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();
        const combined = Buffer.concat([iv, encrypted, authTag]);
        
        return combined.toString('base64'); // clients can decrypt with same key if needed
    } catch (e) {
        console.error("Job ID encryption failed:", e.message);
        return null;
    }
}

// Optional helper if this server ever needs to decode encrypted job_id
function decryptJobId(encryptedBase64) {
    try {
        const combined = Buffer.from(encryptedBase64, 'base64');
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12, -16);
        const authTag = combined.slice(-16);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString('utf8');
    } catch (e) {
        console.error("Job ID decryption failed:", e.message);
        return null;
    }
}

// Random VPS generator
function randomVPS() {
    return `VPS${Math.floor(Math.random() * 100) + 1}`;
}

// Transform source message + decode job_id using your exact deobfuscate logic
function transformMessage(msg) {
    try {
        const data = JSON.parse(msg);
        const brain = (data.brainrots && data.brainrots[0]) 
            ? data.brainrots[0].replace(/\s/g, '') 
            : "unknown";
            
        let genValue = (data.generation && data.generation[0]) 
            ? parseFloat(data.generation[0]) 
            : 0;

        // === DECODE JOB ID USING YOUR LOGIC (converted to JS) ===
        let jobId = data.job_id || "";
        if (typeof jobId === "string" && jobId.includes(",")) {
            jobId = deobfuscateJobId(jobId);
        }

        const encryptedJobId = jobId ? encryptJobId(jobId) : null;

        // Convert to output format (only job_id encrypted)
        return {
            brainrots: [brain],
            generation: [Math.floor(genValue / 1000000).toString()],  // "68" instead of 68000000
            players: data.players || null,
            job_id: encryptedJobId,
            vps: randomVPS()
        };
    } catch (e) {
        console.error("Invalid message from source:", e.message);
        return null;
    }
}

// Your exact deobfuscate logic ported to JavaScript
function deobfuscateJobId(encoded) {
    if (!encoded || typeof encoded !== "string") return encoded;
    const parts = encoded.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    
    if (parts.length === 0) return encoded;

    let idx = 0;
    const checksum = parts[idx++]; 
    const length = parts[idx++]; 
    const offsetSeed = parts[idx++]; 
    const noiseCount = parts[idx++]; 

    const keys = [];
    for (let i = 0; i < 5; i++) keys.push(parts[idx++]);

    const noisePositions = [];
    for (let i = 0; i < noiseCount; i++) noisePositions.push(parts[idx++]);

    let encrypted = parts.slice(idx);

    noisePositions.sort((a, b) => b - a);
    for (const pos of noisePositions) {
        if (pos + 1 < encrypted.length) encrypted.splice(pos + 1, 1);
    }

    for (let i = 0; i < encrypted.length - 1; i += 2) {
        [encrypted[i], encrypted[i + 1]] = [encrypted[i + 1], encrypted[i]];
    }

    const unrotated = [];
    for (let i = 0; i < encrypted.length; i++) {
        let b = encrypted[i];
        const rotation = ((i % 7) + 1);
        const rightShift = Math.floor(b / (1 << rotation));
        const leftShift = (b << (8 - rotation)) & 0xFF;
        unrotated.push(rightShift | leftShift);
    }

    const unxored = [];
    for (let i = 0; i < unrotated.length; i++) {
        let result = unrotated[i];
        for (let j = 0; j < keys.length; j++) {
            if ((i + j) % 2 === 0) {
                result = result ^ keys[j];
            }
        }
        unxored.push(result);
    }

    const decrypted = [];
    for (let i = 0; i < unxored.length; i++) {
        const b = (unxored[i] - ((i * offsetSeed) % 256) + 256) % 256;
        decrypted.push(b);
    }

    let computedChecksum = 0;
    for (const b of decrypted) computedChecksum = (computedChecksum + b) % 256;

    if (computedChecksum !== checksum) {
        console.warn("Checksum mismatch on job_id");
    }

    let result = "";
    for (const b of decrypted) result += String.fromCharCode(b);
    
    // Final cleanup to UUID format
    const hex = result.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (hex.length >= 32) {
        const s = hex.substring(0, 32);
        return `${s.substring(0,8)}-${s.substring(8,12)}-${s.substring(12,16)}-${s.substring(16,20)}-${s.substring(20,32)}`;
    }
    
    return result;
}

// Relay JSON data (only job_id is encrypted)
sourceWS.on('message', (msg) => {
    const formatted = transformMessage(msg);
    if (!formatted) return;

    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(JSON.stringify(formatted));
            count++;
        }
    });

    if (count > 0) console.log(`📤 Update sent to ${count} client(s)`);
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
                success: "✅ Authenticated via URL",
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
        encryption: "job_id only (AES-256-GCM)"
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

