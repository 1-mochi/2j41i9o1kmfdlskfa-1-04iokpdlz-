const WebSocket = require("ws");
const crypto = require("crypto");

const SENDER_AUTH_KEY = "LDJFSIJ3I4J2IO1111";
const ENCRYPTION_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";
const PORT = process.env.PORT  8080;

const wss = new WebSocket.Server({ port: PORT });
console.log(WS relay running on port ${PORT});

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function applyStreamCipher(inputBuf) {
  const keyBase = sha256(Buffer.from(ENCRYPTION_KEY, "utf8"));
  const out = Buffer.alloc(inputBuf.length);
  let blockIndex = 0;
  let block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)]));

  for (let i = 0; i < inputBuf.length; i++) {
    const pos = i % 32;
    if (i > 0 && pos === 0) {
      blockIndex++;
      block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)]));
    }
    out[i] = inputBuf[i] ^ block[pos];
  }
  return out;
}

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function encrypt(plaintext) {
  const inputBuf = Buffer.from(plaintext, "utf8");
  return applyStreamCipher(inputBuf).toString("hex");
}

function broadcastToReceivers(payload) {
  const encrypted = encrypt(JSON.stringify(payload));
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.role === "receiver") {
      client.send(encrypted);
      count++;
    }
  });
  console.log(Broadcast -> ${count} receiver(s));
}

function normalizeAuthFromUrl(rawUrl) {
  if (!rawUrl  !rawUrl.startsWith("/auth/")) return "";
  const noQuery = rawUrl.split("?")[0];
  const tokenPart = noQuery.slice("/auth/".length).replace(//+$/, "");
  try {
    return decodeURIComponent(tokenPart);
  } catch {
    return tokenPart;
  }
}
wss.on("connection", (ws, req) => {
  ws.role = null;

  if (req.url && req.url.startsWith("/auth/")) {
    const provided = normalizeAuthFromUrl(req.url);
    if (provided === SENDER_AUTH_KEY) {
      ws.role = "sender";
      ws.send(
        JSON.stringify({ success: "Sender authenticated", role: "sender" }),
      );
    } else {
      ws.role = "receiver";
      ws.send(JSON.stringify({ success: "Connected", role: "receiver" }));
    }
    bindMessageHandler(ws);
    return;
  }

  ws.role = "receiver";
  ws.send(JSON.stringify({ success: "Connected", role: "receiver" }));
  bindMessageHandler(ws);
});

function bindMessageHandler(ws) {
  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (ws.role === null) {
      if (data.auth === SENDER_AUTH_KEY) {
        ws.role = "sender";
        ws.send(
          JSON.stringify({ success: "Sender authenticated", role: "sender" }),
        );
        return;
      }
      ws.role = "receiver";
      ws.send(JSON.stringify({ success: "Connected", role: "receiver" }));
      return;
    }

    if (ws.role === "sender") {
      broadcastToReceivers(data);
      return;
    }
    ws.send(JSON.stringify({ info: "You are a receiver" }));
  });

  ws.on("close", () => console.log("Client disconnected"));
}
