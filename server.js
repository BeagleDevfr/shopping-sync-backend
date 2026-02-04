// server.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const mysql = require("mysql2/promise");

// =========================
// CONFIG
// =========================
const PORT = Number(process.env.PORT);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// =========================
// APP
// =========================
const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    "http://localhost:8100",
    "https://shoppinglist.netlify.app"
  ],
  credentials: true
}));
app.options("*", cors());

app.get("/", (_req, res) => res.send("OK"));

const server = http.createServer(app);

// =========================
// SOCKET.IO
// =========================
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

// =========================
// MYSQL
// =========================
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10
});

// =========================
// INIT DB
// =========================
async function initDb() {
  console.log("🟡 Init DB…");
  const conn = await db.getConnection();

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(16) PRIMARY KEY,
      name VARCHAR(255),
      created_at BIGINT,
      updated_at BIGINT
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(32) PRIMARY KEY,
      list_id VARCHAR(16),
      name VARCHAR(255),
      checked TINYINT DEFAULT 0,
      category VARCHAR(50),
      added_by JSON,
      updated_at BIGINT,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    )
  `);

  conn.release();
  console.log("✅ Tables MySQL ready");
}
initDb().catch(err => {
  console.error("❌ DB INIT FAILED", err);
  process.exit(1);
});

// =========================
// UTILS
// =========================
const now = () => Date.now();
const safe = (v, m = 80) => typeof v === "string" ? v.trim().slice(0, m) : "";
const createShareId = () => nanoid(7).toUpperCase();

// =========================
// REST
// =========================
app.post("/lists", async (req, res) => {
  const name = safe(req.body?.name, 40) || "Liste partagée";
  const id = createShareId();
  const ts = now();

  await db.execute(
    `INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [id, name, ts, ts]
  );

  res.json({ shareId: id });
});

app.get("/lists/:shareId", async (req, res) => {
  const shareId = req.params.shareId.toUpperCase();

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
      addedBy: i.added_by ? JSON.parse(i.added_by) : null
    }))
  });
});

// =========================
// SOCKET EVENTS (TOUT ICI)
// =========================
io.on("connection", (socket) => {
  console.log("✅ socket connected", socket.id);

  socket.on("JOIN_LIST", async ({ shareId }) => {
    shareId = shareId.toUpperCase();
    socket.join(shareId);

    const [[list]] = await db.execute(
      `SELECT * FROM lists WHERE id = ?`,
      [shareId]
    );

    const [items] = await db.execute(
      `SELECT * FROM items WHERE list_id = ?`,
      [shareId]
    );

    socket.emit("SNAPSHOT", {
      list: {
        shareId,
        name: list?.name ?? "Liste partagée",
        items: items.map(i => ({
          id: i.id,
          name: i.name,
          checked: !!i.checked,
          category: i.category,
          addedBy: i.added_by ? JSON.parse(i.added_by) : null
        }))
      }
    });
  });

  socket.on("ADD_ITEM", async ({ shareId, item }) => {
    const ts = now();

    await db.execute(
      `INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        shareId,
        item.name,
        item.checked ? 1 : 0,
        item.category,
        JSON.stringify(item.addedBy),
        ts
      ]
    );

    io.to(shareId).emit("ITEM_ADDED", {
      item: { ...item, checked: !!item.checked }
    });
  });

  socket.on("TOGGLE_ITEM", async ({ shareId, itemId, checked }) => {
    await db.execute(
      `UPDATE items SET checked = ?, updated_at = ? WHERE id = ? AND list_id = ?`,
      [checked ? 1 : 0, now(), itemId, shareId]
    );

    io.to(shareId).emit("ITEM_TOGGLED", { itemId, checked });
  });

  socket.on("REMOVE_ITEM", async ({ shareId, itemId }) => {
    await db.execute(
      `DELETE FROM items WHERE id = ? AND list_id = ?`,
      [itemId, shareId]
    );

    io.to(shareId).emit("ITEM_REMOVED", { itemId });
  });
});

// =========================
// START
// =========================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
