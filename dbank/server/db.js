const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'dbank.db');
const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
  // Create users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0
    )
  `);

  // Create transactions table
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT CHECK(type IN ('deposit', 'withdraw', 'transfer')),
      amount REAL NOT NULL,
      description TEXT,
      recipient_id INTEGER REFERENCES users(id),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Seed initial admin user (optional)
  const adminEmail = 'admin@dbank.com';
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`
    INSERT OR IGNORE INTO users (name, email, password, balance)
    VALUES (?, ?, ?, ?)
  `, ['Admin', adminEmail, adminPassword, 10000]);
});

module.exports = db;