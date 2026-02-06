const mysql = require("mysql2/promise");

console.log("🟡 Initialisation MySQL…");

const DATABASE_URL =
  process.env.MYSQL_URL ||
  process.env.MYSQL_PUBLIC_URL;

if (!DATABASE_URL) {
  console.error("❌ MYSQL_URL manquant");
  process.exit(1);
}

console.log("DB URL OK");

const db = mysql.createPool(DATABASE_URL);

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

module.exports = db;
