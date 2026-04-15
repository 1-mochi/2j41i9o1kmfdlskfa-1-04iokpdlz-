const WebSocket = require('ws');
const crypto = require('crypto');
const https = require('https');

const SECRET_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";
const ALT_AUTH_KEY = "LDJFSIJ3I4J2IO1111";
const VALID_AUTH_KEYS = new Set([SECRET_KEY, ALT_AUTH_KEY]);

const SALT = "RyHub-Salt-2026-v2-x7K9pQ2mZ8vL4nT6wR";
const PORT = process.env.PORT || 8080;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 2000;

const ENCRYPTION_KEY = crypto.pbkdf2Sync(SECRET_KEY, SALT, 100000, 32, 'sha512');

const wss = new WebSocket.Server({ port: PORT });



const SOURCE_URL = "https://ws.vanishnotifier.org/recent";

function encryptJobId(jobId) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        
        let encrypted = cipher.update(String(jobId ?? ""), 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();
        const combined = Buffer.concat([iv, encrypted, authTag]);
        
        return combined.toString('base64');
    } catch (e) {
        console.error("Job ID encryption failed:", e.message);
        return null;
    }
}

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

function randomVPS() {
    return `VPS${Math.floor(Math.random() * 100) + 1}`;
}

function transformMessage(input) {
    try {
        const data = typeof input === "string" ? JSON.parse(input) : input;
        const brain = (data.brainrots && data.brainrots[0])
            ? String(data.brainrots[0]).replace(/\s/g, '')
            : (data.name || data.base_name || "unknown");
            
        let genValue = (data.generation && data.generation[0])
            ? parseFloat(data.generation[0])
            : Number(data.value || 0);

        let jobId = data.job_id || "";
        if (typeof jobId === "string" && jobId.includes(",")) {
            jobId = deobfuscateJobId(jobId);
        }

        const encryptedJobId = jobId ? encryptJobId(jobId) : null;

        return {
            brainrots: [brain],
            generation: [Math.floor(genValue / 1000000).toString()],
            players: data.players || null,
            job_id: encryptedJobId,
            vps: randomVPS()
        };
    } catch (e) {
        console.error("Invalid message from source:", e.message);
        return null;
    }
}

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

    let result = "";
    for (const b of decrypted) result += String.fromCharCode(b);
    
    const hex = result.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (hex.length >= 32) {
        const s = hex.substring(0, 32);
        return `${s.substring(0,8)}-${s.substring(8,12)}-${s.substring(12,16)}-${s.substring(16,20)}-${s.substring(20,32)}`;
    }
    
    return result;
}

function broadcastFormatted(formatted) {
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(JSON.stringify(formatted));
            count++;
        }
    });
    if (count > 0) console.log(`📤 Update sent to ${count} client(s)`);
}

function fetchRecent() {
    return new Promise((resolve, reject) => {
        const url = new URL(SOURCE_URL);
        const req = https.get({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || 443,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "identity",
                "Connection": "keep-alive",
                "Referer": "https://ws.vanishnotifier.org/",
                "Origin": "https://ws.vanishnotifier.org"
            },
            timeout: 10000
        }, (res) => {
            if (res.statusCode !== 200) {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", chunk => { body += chunk; });
                res.on("end", () => {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                });
                res.resume();
                return;
            }

            let raw = "";
            res.setEncoding("utf8");
            res.on("data", chunk => { raw += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error(`Invalid JSON from source: ${e.message}`));
                }
            });
        });

        req.on("timeout", () => req.destroy(new Error("Source request timeout")));
        req.on("error", reject);
    });
}

const seenJobIds = new Set();
const MAX_SEEN_JOB_IDS = 5000;

function itemsFromApiPayload(payload) {
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.findings)) return payload.findings;
    return [payload];
}

function groupedByJobId(items) {
    const jobs = new Map();
    for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const jobId = String(item.job_id || "").trim();
        if (!jobId) continue;

        if (!jobs.has(jobId)) {
            jobs.set(jobId, []);
        }
        jobs.get(jobId).push(item);
    }
    return jobs;
}

function pickHighestValueItem(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    let best = items[0];
    let bestVal = Number(best?.value || 0);
    for (let i = 1; i < items.length; i++) {
        const cur = items[i];
        const curVal = Number(cur?.value || 0);
        if (curVal > bestVal) {
            best = cur;
            bestVal = curVal;
        }
    }
    return best;
}

async function pollSourceAndRelay() {
    try {
        const payload = await fetchRecent();
        const items = itemsFromApiPayload(payload);
        const jobs = groupedByJobId(items);

        for (const [jobId, groupItems] of jobs.entries()) {
            if (seenJobIds.has(jobId)) continue;
            const bestItem = pickHighestValueItem(groupItems);
            if (!bestItem) continue;

            const formatted = transformMessage(bestItem);
            if (!formatted) continue;

            seenJobIds.add(jobId);
            if (seenJobIds.size > MAX_SEEN_JOB_IDS) {
                const firstKey = seenJobIds.values().next().value;
                seenJobIds.delete(firstKey);
            }

            broadcastFormatted(formatted);
        }
    } catch (err) {
        console.error("❌ Source poll error:", err.message);
    }
}

pollSourceAndRelay();
setInterval(pollSourceAndRelay, POLL_INTERVAL_MS);

wss.on('connection', (ws, req) => {
    console.log('📡 Client connected');
    ws.isAuthenticated = false;

    if (req.url && req.url.startsWith('/auth/')) {
        const provided = decodeURIComponent(req.url.split('/auth/')[1]);
        if (VALID_AUTH_KEYS.has(provided)) {
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
            if (VALID_AUTH_KEYS.has(data.auth)) {
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

