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
function generateShareId() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
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

//await conn.execute(`DROP TABLE IF EXISTS list_members`);
//await conn.execute(`DROP TABLE IF EXISTS items`);
//await conn.execute(`DROP TABLE IF EXISTS lists`);

await conn.execute(`
  CREATE TABLE IF NOT EXISTS lists (
    id VARCHAR(16) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(64) NOT NULL,
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
    added_by JSON NULL,
    updated_at BIGINT,

    INDEX idx_items_list (list_id),

    CONSTRAINT fk_items_list
      FOREIGN KEY (list_id) REFERENCES lists(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB;
`);


  await conn.execute(`
CREATE TABLE IF NOT EXISTS list_members (
  list_id VARCHAR(16) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  pseudo VARCHAR(64),
  joined_at BIGINT,
  PRIMARY KEY (list_id, user_id),
  FOREIGN KEY (list_id) REFERENCES lists(id)
    ON DELETE CASCADE
);

  `);

  await conn.execute(`
  CREATE TABLE IF NOT EXISTS list_bans (
  list_id VARCHAR(16) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  banned_at BIGINT,
  PRIMARY KEY (list_id, user_id),
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

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
    const user = req.body?.user; // { id, pseudo }

    if (!user?.id) {
      return res.status(400).json({ error: "USER_REQUIRED" });
    }

    const shareId = nanoid(7).toUpperCase();
    const ts = Date.now();

    // ✅ création de la liste avec propriétaire
    await db.execute(
      `INSERT INTO lists (id, name, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [shareId, name, user.id, ts, ts]
    );

    // ✅ le créateur est aussi membre
    await db.execute(
      `INSERT INTO list_members (list_id, user_id, pseudo, joined_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, user.id, user.pseudo ?? null, ts]
    );

    res.json({ shareId });
  } catch (err) {
    console.error("❌ CREATE LIST FAILED", err);
    res.status(500).json({ error: "CREATE_LIST_FAILED" });
  }
});



app.post("/lists/:shareId/join", async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();
    const { user } = req.body;

    if (!user?.id) {
      return res.status(400).json({ error: "NO_USER" });
    }

    const now = Date.now();

    await db.execute(
      `INSERT IGNORE INTO list_members (list_id, user_id, pseudo, joined_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, user.id, user.pseudo, now]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ JOIN LIST ERROR", err);
    res.status(500).json({ error: "JOIN_FAILED" });
  }
});

async function ensureListMember(shareId, user) {
  // ✅ sécurité absolue
  if (!user || !user.id) return;

  await db.execute(
    `
    INSERT IGNORE INTO list_members (list_id, user_id, pseudo, joined_at)
    VALUES (?, ?, ?, ?)
    `,
    [
      shareId,
      user.id,
      user.pseudo ?? null,
      Date.now(),
    ]
  );
}

app.get("/lists/:shareId", async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();

    /* =========================
       1️⃣ VÉRIFIER LA LISTE
    ========================= */
    const [[list]] = await db.execute(
      `SELECT * FROM lists WHERE id = ?`,
      [shareId]
    );

    if (!list) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    /* =========================
       2️⃣ CHARGER LES ITEMS
    ========================= */
    const [items] = await db.execute(
      `SELECT * FROM items WHERE list_id = ? ORDER BY id ASC`,
      [shareId]
    );

    /* =========================
       3️⃣ RÉPONSE
    ========================= */
    res.json({
      list: {
        id: list.id,
        name: list.name,
        owner_id: list.owner_id,
        created_at: list.created_at,
        updated_at: list.updated_at,
      },
      items: items.map(i => ({
        id: i.id,
        name: i.name,
        checked: !!i.checked,
        category: i.category,
        addedBy: parseAddedBy(i.added_by),
        updatedAt: i.updated_at,
      })),
    });

  } catch (err) {
    console.error("❌ GET /lists ERROR", err);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});






// =========================
// 👥 MEMBERS LIST
// =========================
// =========================
// GET MEMBERS OF A LIST
// =========================
app.get("/lists/:shareId/members", async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();

    const [rows] = await db.execute(
      `
      SELECT user_id, pseudo, joined_at
      FROM list_members
      WHERE list_id = ?
      ORDER BY joined_at ASC
      `,
      [shareId]
    );

    const members = rows.map(r => ({
      id: r.user_id,
      pseudo: r.pseudo,
      joinedAt: r.joined_at,
    }));

    res.json({ members });
  } catch (err) {
    console.error("❌ GET MEMBERS ERROR", err);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});



app.get("/lists/:shareId/members-count", async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();

    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS count
       FROM list_members
       WHERE list_id = ?`,
      [shareId]
    );

    res.json({ count: row.count });
  } catch (err) {
    console.error("❌ MEMBERS COUNT ERROR", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

app.put('/lists/:shareId/rename', async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();
    const { name } = req.body;
    const user = req.user;

    if (!user?.id) {
      return res.status(401).json({ error: 'USER_REQUIRED' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ error: 'NAME_REQUIRED' });
    }

    // 🔐 vérifier propriétaire
    const [[list]] = await db.execute(
      `SELECT owner_id FROM lists WHERE id = ?`,
      [shareId]
    );

    if (!list) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    if (list.owner_id !== user.id) {
      return res.status(403).json({ error: 'NOT_OWNER' });
    }

    await db.execute(
      `UPDATE lists SET name = ?, updated_at = ? WHERE id = ?`,
      [name.trim(), Date.now(), shareId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error('❌ RENAME LIST ERROR', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// =========================
// SOCKET EVENTS
// =========================
io.on("connection", socket => {
  console.log("🔌 Socket connecté:", socket.id);

  // =========================
  // JOIN LIST
  // =========================
io.on("connection", socket => {
  console.log("🔌 Socket connecté:", socket.id);

  // =========================
  // JOIN LIST
  // =========================
  socket.on("JOIN_LIST", async ({ shareId, userId }) => {
    try {
      if (!shareId || !userId) {
        console.warn("⚠️ JOIN_LIST invalide", { shareId, userId });
        socket.emit("SNAPSHOT", []);
        return;
      }

      shareId = shareId.toUpperCase();

      console.log("📡 JOIN_LIST", { shareId, userId });

      /* =========================
         🚫 VÉRIF BANNI (AVANT TOUT)
      ========================= */
      const [[ban]] = await db.execute(
        `SELECT 1 FROM list_bans WHERE list_id = ? AND user_id = ?`,
        [shareId, userId]
      );

      if (ban) {
        console.warn("⛔ USER BANNED", userId);

        socket.emit("JOIN_DENIED", {
          reason: "BANNED",
        });

        return; // ⛔ STOP ICI
      }

      /* =========================
         ✅ JOIN ROOM
      ========================= */
      socket.join(shareId);

      /* =========================
         📦 LOAD ITEMS
      ========================= */
      const [rows] = await db.execute(
        `SELECT * FROM items WHERE list_id = ? ORDER BY updated_at ASC`,
        [shareId]
      );

      const items = rows.map(row => ({
        id: row.id,
        name: row.name,
        checked: !!row.checked,
        category: row.category,

        // 🔒 PARSE SAFE
        addedBy:
          typeof row.added_by === "string"
            ? (() => {
                try {
                  return JSON.parse(row.added_by);
                } catch {
                  return null;
                }
              })()
            : row.added_by ?? null,
      }));

      console.log("📸 SNAPSHOT SEND", items.length);

      socket.emit("SNAPSHOT", items);

      /* =========================
         👥 PRESENCE
      ========================= */
      io.to(shareId).emit("PRESENCE", {
        count: io.sockets.adapter.rooms.get(shareId)?.size ?? 1,
      });

    } catch (err) {
      console.error("❌ JOIN_LIST ERROR", err);
      socket.emit("SNAPSHOT", []);
    }
  });
});


async function ensureMember(shareId, user) {
  await db.execute(
    `
    INSERT IGNORE INTO list_members (list_id, user_id, pseudo, joined_at)
    VALUES (?, ?, ?, ?)
    `,
    [
      shareId,
      user.id,
      user.pseudo,
      Date.now()
    ]
  );
}


  // =========================
  // ADD ITEM
  // =========================
socket.on("ADD_ITEM", async ({ shareId, item }) => {
  try {
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
        JSON.stringify(item.addedBy ?? null), // ✅ OK
        Date.now(),
      ]
    );

    io.to(shareId).emit("ITEM_ADDED", item);
  } catch (err) {
    console.error("❌ ADD_ITEM ERROR", err);
  }
});


  // =========================
  // TOGGLE ITEM
  // =========================
  socket.on("TOGGLE_ITEM", async ({ shareId, itemId, checked }) => {
    try {
      await db.execute(
        `UPDATE items
         SET checked = ?, updated_at = ?
         WHERE id = ? AND list_id = ?`,
        [checked ? 1 : 0, Date.now(), itemId, shareId]
      );

      io.to(shareId).emit("ITEM_TOGGLED", { itemId, checked });
    } catch (err) {
      console.error("❌ TOGGLE_ITEM ERROR", err);
    }
  });

  // =========================
  // REMOVE ITEM
  // =========================
  socket.on("REMOVE_ITEM", async ({ shareId, itemId }) => {
    try {
      await db.execute(
        `DELETE FROM items WHERE id = ? AND list_id = ?`,
        [itemId, shareId]
      );

      io.to(shareId).emit("ITEM_REMOVED", { itemId });
    } catch (err) {
      console.error("❌ REMOVE_ITEM ERROR", err);
    }
  });


app.delete('/lists/:shareId/members/:userId', async (req, res) => {
  try {
    const shareId = req.params.shareId.toUpperCase();
    const removedUserId = req.params.userId;

    // 🔥 suppression en base
    await db.execute(
      `DELETE FROM list_members WHERE list_id = ? AND user_id = ?`,
      [shareId, removedUserId]
    );

// 2️⃣ ajouter dans list_bans
await db.execute(
  `INSERT IGNORE INTO list_bans (list_id, user_id, banned_at)
   VALUES (?, ?, ?)`,
  [shareId, removedUserId, Date.now()]
);

    // 🔥 NOTIFICATION TEMPS RÉEL
    io.to(shareId).emit('MEMBER_REMOVED', {
      
      shareId,
      userId: removedUserId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ REMOVE MEMBER ERROR', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});



  // =========================
  // DISCONNECT
  // =========================
  socket.on("disconnect", () => {
    console.log("❌ Socket déconnecté:", socket.id);
  });
});



// =========================
// START
// =========================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});

