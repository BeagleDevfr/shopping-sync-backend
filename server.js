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
// CONFIG
// =========================
const PORT = Number(process.env.PORT || 8080);

// ⚠️ ORIGINES AUTORISÉES (WEB + ANDROID)
const ALLOWED_ORIGINS = [
  "http://localhost:8100",
  "https://shoppinglist.netlify.app",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost", // 🔥 ANDROID CAPACITOR
];


// =========================
// APP
// =========================
const app = express();
app.use(express.json());

// LOG ORIGIN (DEBUG MOBILE)
app.use((req, _res, next) => {
  console.log("🌍 ORIGIN:", req.headers.origin);
  next();
});

// CORS GLOBAL
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // Android WebView
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      console.error("❌ CORS BLOCKED:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.options("*", cors());

// HEALTHCHECK RAILWAY
app.get("/", (_req, res) => res.status(200).send("OK"));

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
// MYSQL
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

    const user = req.body?.user; // { id, pseudo }

    console.log("📦 CREATE LIST", shareId, name);

    await db.execute(
      `INSERT INTO lists (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, name, ts, ts]
    );

    // 👤 AJOUT DU CRÉATEUR COMME MEMBRE
    if (user?.id) {
      await db.execute(
        `INSERT INTO list_members (id, list_id, user_id, pseudo, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        [nanoid(), shareId, user.id, user.pseudo ?? null, ts]
      );
    }

    res.json({ shareId });
  } catch (err) {
    console.error("❌ CREATE LIST FAILED", err);
    res.status(500).json({ error: "CREATE_LIST_FAILED" });
  }
});

app.post("/lists/:shareId/join", async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();
    const user = req.body?.user; // { id, pseudo }

    if (!user?.id) {
      return res.status(400).json({ error: "USER_REQUIRED" });
    }

    await db.execute(
      `INSERT IGNORE INTO list_members
       (id, list_id, user_id, pseudo, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
      [nanoid(), shareId, user.id, user.pseudo ?? null, now()]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ JOIN LIST FAILED", err);
    res.status(500).json({ error: "JOIN_LIST_FAILED" });
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
      addedBy: parseAddedBy(i.added_by),
      updatedAt: i.updated_at,
    })),
  });
});

// =========================
// SOCKET EVENTS
// =========================
io.on("connection", socket => {
  console.log("✅ socket connected", socket.id);

  socket.on("JOIN_LIST", async ({ shareId }) => {
    shareId = String(shareId || "").toUpperCase();
    socket.join(shareId);

    console.log("👥 JOIN_LIST", shareId);

    const [[list]] = await db.execute(
      `SELECT * FROM lists WHERE id = ?`,
      [shareId]
    );

    const [items] = await db.execute(
      `SELECT * FROM items WHERE list_id = ? ORDER BY updated_at DESC`,
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
          addedBy: parseAddedBy(i.added_by),
        })),
      },
    });
  });

  socket.on("ADD_ITEM", async ({ shareId, item }) => {
    const ts = now();
    const addedBy =
      item.addedBy && typeof item.addedBy === "object"
        ? JSON.stringify(item.addedBy)
        : null;

    await db.execute(
      `INSERT INTO items
       (id, list_id, name, checked, category, added_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        shareId,
        item.name,
        item.checked ? 1 : 0,
        item.category,
        addedBy,
        ts,
      ]
    );

    io.to(shareId).emit("ITEM_ADDED", {
      item: { ...item, checked: !!item.checked },
    });
  });

  socket.on("TOGGLE_ITEM", async ({ shareId, itemId, checked }) => {
    await db.execute(
      `UPDATE items
       SET checked = ?, updated_at = ?
       WHERE id = ? AND list_id = ?`,
      [checked ? 1 : 0, now(), itemId, shareId]
    );

    io.to(shareId).emit("ITEM_TOGGLED", { itemId, checked: !!checked });
  });

  socket.on("REMOVE_ITEM", async ({ shareId, itemId }) => {
    await db.execute(
      `DELETE FROM items WHERE id = ? AND list_id = ?`,
      [itemId, shareId]
    );

    io.to(shareId).emit("ITEM_REMOVED", { itemId });
  });
});


app.get('/lists/:shareId/members', async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();

    const [rows] = await db.execute(
      `SELECT user_id, pseudo, joined_at
       FROM list_members
       WHERE list_id = ?
       ORDER BY joined_at ASC`,
      [shareId]
    );

    res.json({
      members: rows.map(r => ({
        id: r.user_id,
        pseudo: r.pseudo ?? 'Inconnu',
        joinedAt: r.joined_at,
      })),
    });
  } catch (err) {
    console.error('❌ GET MEMBERS FAILED', err);
    res.status(500).json({ error: 'GET_MEMBERS_FAILED' });
  }
});




// =========================
// 👥 MEMBERS COUNT
app.get('/lists/:shareId/members-count', async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();

    const [rows] = await db.execute(
      `SELECT COUNT(*) AS count
       FROM list_members
       WHERE list_id = ?`,
      [shareId]
    );

    res.json({ count: rows[0].count });
  } catch (err) {
    console.error('❌ GET MEMBERS COUNT FAILED', err);
    res.status(500).json({ error: 'GET_MEMBERS_COUNT_FAILED' });
  }
});




// =========================
// STARTghjg
// =========================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
