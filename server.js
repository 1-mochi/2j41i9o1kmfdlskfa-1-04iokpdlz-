const WebSocket = require("ws");
const crypto = require("crypto");

const SOURCE_URL = "wss://websocket.hellgen.com
";
const SOURCE_AUTH_KEY =
  "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";
const ENCRYPTION_KEY =
  "123456724I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO28901234567890123456789012";
const PORT = process.env.PORT || 8080;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function encrypt(plaintext) {
  const inputBuf = Buffer.from(plaintext, "utf8");
  const keyBase = sha256(Buffer.from(ENCRYPTION_KEY, "utf8"));
  const out = Buffer.alloc(inputBuf.length);
  let blockIndex = 0;
  let block = sha256(Buffer.concat([keyBase, uint32BE(0)]));

  for (let i = 0; i < inputBuf.length; i++) {
    const pos = i % 32;
    if (i > 0 && pos === 0) {
      blockIndex++;
      block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)]));
    }
    out[i] = inputBuf[i] ^ block[pos];
  }
  return out.toString("hex");
}

function broadcastToReceivers(raw) {
  const encrypted = encrypt(raw);
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encrypted);
      count++;
    }
  });
  console.log(`📤 Broadcast encrypted -> ${count} receiver(s)`);
}

const wss = new WebSocket.Server({ port: PORT });
console.log(`✅ WS relay server running on port ${PORT}`);

wss.on("connection", (ws) => {
  console.log("📡 Lua receiver connected");
  ws.send(JSON.stringify({ success: "Connected", role: "receiver" }));
  ws.on("close", () => console.log("👋 Lua receiver disconnected"));
});

let source = null;
let srcAuthed = false;

function connectSource() {
  source = new WebSocket(SOURCE_URL);
  srcAuthed = false;

  source.on("open", () => {
    console.log("📡 Connected to source WS — authenticating…");
    source.send(JSON.stringify({ auth: SOURCE_AUTH_KEY }));
  });

  source.on("message", (msg) => {
    const raw = msg.toString();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      /* not JSON */
    }

    if (!srcAuthed) {
      if (data && (data.success || data.role === "receiver")) {
        srcAuthed = true;
        console.log("🔑 Authenticated with source WS");
      } else {
        console.warn("[source] Auth response:", raw);
      }
      return;
    }

    console.log("📨 Log received from source — broadcasting encrypted");
    broadcastToReceivers(raw);
  });

  source.on("close", () => {
    srcAuthed = false;
    console.log("⚠️ Source closed — reconnecting in 5s…");
    setTimeout(connectSource, 5000);
  });

  source.on("error", (err) => {
    srcAuthed = false;
    console.error("❌ Source error:", err.message);
  });
}

connectSource();
