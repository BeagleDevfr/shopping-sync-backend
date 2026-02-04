// server.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const mysql = require("mysql2/promise");

// =========================
// CONFIG (IMPORTANT RAILWAY)
// =========================
const PORT = Number(process.env.PORT); // ⚠️ PAS de fallback
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// =========================
// APP + HTTP
// =========================
const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const server = http.createServer(app);

// =========================
// SOCKET.IO
// =========================
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// =========================
// MYSQL POOL
// =========================
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

// =========================
// INIT DB
// =========================
async function initDb() {
  console.log("🟡 Init DB…");

  const conn = await db.getConnection();
  console.log("✅ MySQL connected");

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(16) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT,
      updated_at BIGINT
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(32) PRIMARY KEY,
      list_id VARCHAR(16) NOT NULL,
      name VARCHAR(255) NOT NULL,
      checked TINYINT DEFAULT 0,
      category VARCHAR(50),
      added_by JSON,
      updated_at BIGINT,
      FOREIGN KEY (list_id) REFERENCES lists(id)
        ON DELETE CASCADE
    )
  `);

  conn.release();
  console.log("✅ Tables MySQL ready");
}

initDb().catch(err => {
  console.error("❌ DB INIT FAILED");
  console.error(err);
  process.exit(1);
});

// =========================
// UTILS
// =========================
const now = () => Date.now();
const safeString = (x, max = 80) =>
  typeof x === "string" ? x.trim().slice(0, max) : "";

const createShareId = () => nanoid(7).toUpperCase();

function getPublicBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["host"];
  return `${proto}://${host}`;
}

// =========================
// REST API
// =========================
app.post("/lists", async (req, res) => {
  try {
    const name = safeString(req.body?.name, 40) || "Liste partagée";
    const shareId = createShareId();
    const ts = now();

    console.log("📦 CREATE LIST", shareId, name);

    await db.execute(
      `INSERT INTO lists (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, name, ts, ts]
    );

    const baseUrl = getPublicBaseUrl(req);

    res.json({
      shareId,
      wsUrl: baseUrl,
      joinUrl: `${baseUrl}/join/${shareId}`,
    });
  } catch (err) {
    console.error("❌ CREATE LIST FAILED", err);
    res.status(500).json({ error: "CREATE_LIST_FAILED" });
  }
});

app.get("/lists/:shareId", async (req, res) => {
  const shareId = String(req.params.shareId || "").toUpperCase();

  const [[list]] = await db.execute(
    `SELECT * FROM lists WHERE id = ?`,
    [shareId]
  );

  if (!list) return res.status(404).json({ error: "NOT_FOUND" });

  const [items] = await db.execute(
    `SELECT * FROM items WHERE list_id = ? ORDER BY updated_at DESC`,
    [shareId]
  );

  res.json({
    list,
    items: items.map(i => ({
      id: i.id,
      name: i.name,
      checked: !!i.checked,
      category: i.category,
      addedBy: i.added_by ? JSON.parse(i.added_by) : null,
      updatedAt: i.updated_at,
    })),
  });
});

// =========================
// SOCKET EVENTS
// =========================
io.on("connection", (socket) => {
  console.log("✅ connected:", socket.id);

  socket.on("JOIN_LIST", async ({ shareId }) => {
    shareId = String(shareId || "").toUpperCase();
    socket.join(shareId);

    const [items] = await db.execute(
      `SELECT * FROM items WHERE list_id = ? ORDER BY updated_at DESC`,
      [shareId]
    );

    socket.emit("SNAPSHOT", {
      list: {
        items: items.map(i => ({
          id: i.id,
          name: i.name,
          checked: !!i.checked,
          category: i.category,
          addedBy: i.added_by ? JSON.parse(i.added_by) : null,
        })),
      },
    });
  });

  socket.on("ADD_ITEM", async ({ shareId, item }) => {
    const ts = now();

    await db.execute(
      `INSERT INTO items (id, list_id, name, checked, category, added_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        shareId,
        item.name,
        item.checked ? 1 : 0,
        item.category,
        JSON.stringify(item.addedBy),
        ts,
      ]
    );

    io.to(shareId).emit("ITEM_ADDED", {
      item: { ...item, checked: !!item.checked },
    });
  });
});

// =========================
// START (NE DOIT JAMAIS S’ARRÊTER)
// =========================
server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
