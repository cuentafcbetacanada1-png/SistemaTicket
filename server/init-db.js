#!/usr/bin/env node
/**
 * Script de inicialización de base de datos
 * Carga usuarios de admins.json a la BD SQLite
 * Uso: node server/init-db.js
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'iceberg.db');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const db = new sqlite3.Database(DB_FILE);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initializeDatabase() {
  try {
    console.log('[DB INIT] Inicializando base de datos...');

    await run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user',
      area TEXT,
      active INTEGER DEFAULT 1,
      requiresNameVerification INTEGER DEFAULT 0
    )`);

    await run(`CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      priority TEXT,
      status TEXT DEFAULT 'abierto',
      area TEXT,
      location TEXT,
      asset TEXT,
      software TEXT,
      assignedTo TEXT,
      createdBy TEXT,
      phone TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      notes TEXT DEFAULT '[]',
      history TEXT DEFAULT '[]'
    )`);

    // Crear tabla de backups
    await run(`CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      type TEXT,
      ticketCount INTEGER,
      sizeBytes INTEGER,
      createdAt TEXT
    )`);

    console.log('[DB INIT] ✅ Tablas creadas/verificadas');

    // Cargar usuarios de admins.json
    if (fs.existsSync(ADMINS_FILE)) {
      const adminsData = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
      const users = adminsData.users || [];

      for (const user of users) {
        const existingUser = await get('SELECT id FROM users WHERE id = ?', [user.id]);
        
        if (!existingUser) {
          // Hash de la contraseña
          const hashedPassword = user.password 
            ? crypto.createHash('sha256').update(user.password).digest('hex')
            : null;

          await run(
            `INSERT INTO users (id, name, email, password, role, area, active, requiresNameVerification)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              user.id,
              user.name,
              user.email.toLowerCase(),
              hashedPassword,
              user.role || 'user',
              user.area || 'Sistemas',
              user.active ? 1 : 0,
              user.requiresNameVerification ? 1 : 0
            ]
          );
          console.log(`[DB INIT] ✅ Usuario creado: ${user.email}`);
        } else {
          console.log(`[DB INIT] ⚠️  Usuario ya existe: ${user.email}`);
        }
      }
    }

    console.log('[DB INIT] ✅ Base de datos inicializada correctamente');
    process.exit(0);

  } catch (err) {
    console.error('[DB INIT] ❌ Error:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Ejecutar inicialización
initializeDatabase();
