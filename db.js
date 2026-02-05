const mysql = require("mysql2/promise");

console.log("🟡 Initialisation MySQL…");

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

(async () => {
  try {
    const conn = await db.getConnection();
    console.log("✅ Connexion MySQL OK");
    conn.release();
  } catch (err) {
    console.error("❌ MySQL CONNECTION FAILED");
    console.error(err);
    process.exit(1);
  }
})();

async function initDB() {
  console.log("🟡 Initialisation des tables…");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(16) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT,
      updated_at BIGINT
    )
  `);

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

  console.log("🎉 DB READY");
}

initDB().catch(err => {
  console.error("❌ DB INIT FAILED");
  console.error(err);
  process.exit(1);
});

module.exports = db;
