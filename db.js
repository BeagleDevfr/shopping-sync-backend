const mysql = require("mysql2/promise");

console.log("🟡 Initialisation MySQL…");

// =========================
// 🔍 DEBUG ENV (TEMPORAIRE)
// =========================
console.log("🔎 MYSQLHOST =", process.env.MYSQLHOST);
console.log("🔎 MYSQLUSER =", process.env.MYSQLUSER);
console.log("🔎 MYSQLDATABASE =", process.env.MYSQLDATABASE);
console.log("🔎 MYSQLPORT =", process.env.MYSQLPORT);

// =========================
// MYSQL CONNECTION (Railway)
// =========================

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT,
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

  // LISTS
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(16) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT,
      updated_at BIGINT
    )
  `);
  console.log("✅ Table lists OK");

  // ITEMS
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

  console.log("🎉 Base MySQL prête");
}

// ⚠️ APPEL UNIQUE AU DÉMARRAGE
initDB().catch(err => {
  console.error("❌ ERREUR INIT DB");
  console.error(err);
  process.exit(1);
});

module.exports = db;
