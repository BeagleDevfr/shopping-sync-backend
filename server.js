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
app.use(cors({ origin: true }));

// HEALTHCHECK
app.get("/", (_, res) => res.send("OK"));

// ✅ BONUS : éviter "Cannot GET /lists"
app.get("/lists", (_req, res) => {
  res.status(405).json({
    error: "USE_POST_NOT_GET",
    message: "Use POST /lists to create a shared list",
  });
});

const server = http.createServer(app);

// =========================
// SOCKET.IO
// =========================
const io = new Server(server, {
  cors: { origin: true },
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
});

// =========================
// INIT DB
// =========================
(async () => {
  console.log("🟡 Init DB…");
  const conn = await db.getConnection();
  console.log("✅ MySQL connected");

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
      FOREIGN KEY (list_id) REFERENCES lists(id)
        ON DELETE CASCADE
    )
  `);

  conn.release();
  console.log("✅ Tables MySQL ready");
})();

// =========================
// UTILS
// =========================
const now = () => Date.now();
const createShareId = () => nanoid(7).toUpperCase();

// =========================
// REST
// =========================
app.post("/lists", async (req, res) => {
  try {
    const name = req.body?.name || "Liste partagée";
    const shareId = createShareId();
    const ts = now();

    await db.execute(
      `INSERT INTO lists (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [shareId, name, ts, ts]
    );

    const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    res.json({
      shareId,
      joinUrl: `${baseUrl}/join/${shareId}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "CREATE_LIST_FAILED" });
  }
});

app.get("/lists/:shareId", async (req, res) => {
  const shareId = req.params.shareId.toUpperCase();

  const [[list]] = await db.execute(
    "SELECT * FROM lists WHERE id = ?",
    [shareId]
  );

  if (!list) return res.status(404).json({ error: "NOT_FOUND" });

  const [items] = await db.execute(
    "SELECT * FROM items WHERE list_id = ?",
    [shareId]
  );

  res.json({ list, items });
});

// =========================
// START
// =========================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
