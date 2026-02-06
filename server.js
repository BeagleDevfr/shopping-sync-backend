// =========================
// DEBUG ENV (OBLIGATOIRE)
// =========================
console.log("DB ENV", {
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  database: process.env.MYSQLDATABASE,
});

// =========================
// UTILS
// =========================
function parseAddedBy(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

const now = () => Date.now();
const safe = (v, m = 80) =>
  typeof v === "string" ? v.trim().slice(0, m) : "";

// =========================
// IMPORTS
// =========================
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const mysql = require("mysql2/promise");

// =========================
// CONFIGsdfsdf-s
// =========================
const PORT = Number(process.env.PORT || 8080);

const ALLOWED_ORIGINS = [
  "http://localhost:8100",
  "https://shoppinglist.netlify.app",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
];


// =========================
// APP
// =========================
const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  console.log("🌍 ORIGIN:", req.headers.origin);
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // mobile / capacitor
      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// 🔥 OBLIGATOIRE POUR LE PREFLIGHT
app.options("*", cors());


app.get("/", (_req, res) => res.send("OK"));

const server = http.createServer(app);

// =========================
// SOCKET.IO
// =========================
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
});

// =========================
// MYSQL (FIX CRITIQUE)
// =========================
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: Number(process.env.MYSQLPORT),
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
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

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS list_members (
      id VARCHAR(32) PRIMARY KEY,
      list_id VARCHAR(16) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      pseudo VARCHAR(50),
      joined_at BIGINT,
      UNIQUE KEY unique_member (list_id, user_id),
      FOREIGN KEY (list_id) REFERENCES lists(id)
        ON DELETE CASCADE
    )
  `);

  conn.release();
  console.log("✅ MySQL READY");
}

initDb().catch(err => {
  console.error("❌ DB INIT FAILED", err);
  process.exit(1);
});

// =========================
// REST API
// =========================
app.post("/lists", async (req, res) => {
  try {
    const name = safe(req.body?.name, 40) || "Liste partagée";
    const shareId = nanoid(7).toUpperCase();
    const ts = now();

    await db.execute(
      `INSERT INTO lists (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, name, ts, ts]
    );

    const user = req.body?.user;
    if (user?.id) {
      await db.execute(
        `INSERT IGNORE INTO list_members
         (id, list_id, user_id, pseudo, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        [nanoid(), shareId, user.id, user.pseudo ?? null, ts]
      );
    }

    res.json({ shareId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "CREATE_LIST_FAILED" });
  }
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
      addedBy: parseAddedBy(i.added_by),
      updatedAt: i.updated_at,
    })),
  });
});


app.get("/lists/:shareId/members-count", (req, res) => {
  const { shareId } = req.params;
  const room = io.sockets.adapter.rooms.get(shareId);

  const count = room ? room.size : 1;

  res.json({ count });
});

// =========================
// SOCKET EVENTS
// =========================
io.on("connection", socket => {

  socket.on("JOIN_LIST", async ({ shareId }) => {
    shareId = shareId.toUpperCase();
    socket.join(shareId);

    const [rows] = await db.execute(
      `SELECT * FROM items WHERE list_id = ? ORDER BY created_at ASC`,
      [shareId]
    );

    // ✅ NORMALISATION DES ITEMS
    const items = rows.map(row => ({
      id: row.id,
      name: row.name,
      checked: !!row.checked,
      category: row.category,
      addedBy: row.addedBy ? JSON.parse(row.addedBy) : null,
    }));

    // ✅ ENVOI DIRECT DU TABLEAU
    socket.emit("SNAPSHOT", items);
  });

  socket.on("ADD_ITEM", async ({ shareId, item }) => {
    await db.execute(
      `INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        shareId,
        item.name,
        item.checked ? 1 : 0,
        item.category,
        JSON.stringify(item.addedBy ?? null),
        now(),
      ]
    );

    io.to(shareId).emit("ITEM_ADDED", item);
  });

  socket.on("TOGGLE_ITEM", async ({ shareId, itemId, checked }) => {
    await db.execute(
      `UPDATE items SET checked = ? WHERE id = ? AND list_id = ?`,
      [checked ? 1 : 0, itemId, shareId]
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

