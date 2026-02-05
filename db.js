const mysql = require("mysql2/promise");

console.log("🟡 Initialisation MySQL…");

// =========================
// 🔍 DEBUG ENV (TEMPORAIRE)
// =========================
console.log("🧪 ENV CHECK", {
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_PORT: process.env.MYSQL_PORT,
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_DATABASE: process.env.MYSQL_DATABASE,
});

// =========================
// MYSQL CONNECTION (Railway)
// =========================
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,       // ❌ PAS de localhost fallback
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

console.log("✅ MySQL pool créé");

// =========================
// TEST CONNEXION
// =========================
(async () => {
  try {
    const conn = await db.getConnection();
    console.log("✅ Connexion MySQL OK");
    conn.release();
  } catch (err) {
    console.error("❌ Connexion MySQL ÉCHOUÉE");
    console.error(err);
    process.exit(1);
  }
})();

// =========================
// INIT TABLES
// =========================
async function initDB() {
  console.log("🟡 Initialisation des tables MySQL…");

  // =========================
  // LISTS
  // =========================
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(16) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT,
      updated_at BIGINT
    )
  `);
  console.log("✅ Table lists OK");

  // =========================
  // ITEMS
  // =========================
  await db.execute(`
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
  console.log("✅ Table items OK");

  // =========================
  // 👥 LIST MEMBERS (NOUVEAU)
  // =========================
  await db.execute(`
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
  console.log("✅ Table list_members OK");

  console.log("🎉 Base MySQL prête");
}

// ⚠️ APPEL UNIQUE AU DÉMARRAGE
initDB().catch(err => {
  console.error("❌ ERREUR INIT DB");
  console.error(err);
  process.exit(1);
});

module.exports = db;
