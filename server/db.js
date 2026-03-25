'use strict';
const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true, 
    trustServerCertificate: true,
    connectTimeout: 30000, 
    requestTimeout: 30000
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(async pool => {
    console.log('[MASTER] ✅ BASE DE DATOS SQL SERVER CONECTADA.');
    
    // ASEGURAMOS LAS TABLAS EN TU SQL SERVER (SSMS) SI NO EXISTEN
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tickets' AND xtype='U')
        CREATE TABLE tickets (
          id_seq INT IDENTITY(1,1) PRIMARY KEY,
          id NVARCHAR(50),
          title NVARCHAR(255),
          description NVARCHAR(MAX),
          category NVARCHAR(50),
          priority NVARCHAR(50),
          status NVARCHAR(50),
          area NVARCHAR(100),
          location NVARCHAR(255),
          asset NVARCHAR(100),
          software NVARCHAR(100),
          assignedTo NVARCHAR(100),
          createdBy NVARCHAR(MAX),
          phone NVARCHAR(50),
          createdAt NVARCHAR(100),
          updatedAt NVARCHAR(100),
          notes NVARCHAR(MAX),
          history NVARCHAR(MAX)
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
        CREATE TABLE users (
          id NVARCHAR(100) PRIMARY KEY,
          name NVARCHAR(255),
          email NVARCHAR(255),
          password NVARCHAR(255),
          role NVARCHAR(50),
          area NVARCHAR(100),
          active INT DEFAULT 1,
          requiresNameVerification INT DEFAULT 0
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='notifications' AND xtype='U')
        CREATE TABLE notifications (
          id NVARCHAR(100) PRIMARY KEY,
          userId NVARCHAR(255),
          ticketId NVARCHAR(50),
          title NVARCHAR(255),
          message NVARCHAR(MAX),
          type NVARCHAR(50),
          timestamp NVARCHAR(100),
          read INT DEFAULT 0
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_logs' AND xtype='U')
        CREATE TABLE audit_logs (
          id INT IDENTITY(1,1) PRIMARY KEY,
          actor NVARCHAR(255),
          action NVARCHAR(100),
          targetId NVARCHAR(100),
          details NVARCHAR(MAX),
          timestamp DATETIME DEFAULT GETDATE()
        );
      `);
      console.log('[SCHEMA] ✅ TABLAS SINCRONIZADAS EN SQL SERVER.');
    } catch(e) { console.error('[SCHEMA ERR]', e.message); }
    
    return pool;
  })
  .catch(err => {
    console.error('[DATABASE CRITICAL ERROR]', err.message);
    throw err;
  });

function safeParse(json, fallback = {}) {
  try { return typeof json === 'string' ? JSON.parse(json) : json; } catch { return fallback; }
}

module.exports = {
  async get(q, p = []) {
    const pool = await poolPromise;
    const res = await pool.request();
    let finalQ = q;
    p.forEach((v, i) => {
      res.input(`p${i}`, v);
      // Reemplaza el primer '?' que encuentre por '@pX'
      finalQ = finalQ.replace('?', `@p${i}`);
    });
    const data = await res.query(finalQ);
    return data.recordset[0];
  },

  async all(q, p = []) {
    const pool = await poolPromise;
    const res = await pool.request();
    let finalQ = q;
    p.forEach((v, i) => {
      res.input(`p${i}`, v);
      finalQ = finalQ.replace('?', `@p${i}`);
    });
    const data = await res.query(finalQ);
    return data.recordset;
  },

  async run(q, p = []) {
    const pool = await poolPromise;
    const res = await pool.request();
    let finalQ = q;
    p.forEach((v, i) => {
      res.input(`p${i}`, v);
      finalQ = finalQ.replace('?', `@p${i}`);
    });
    const data = await res.query(finalQ);
    return { lastID: data.recordset && data.recordset[0] && (data.recordset[0].id_seq || data.recordset[0].id) };
  },

  async getAll() {
    const pool = await poolPromise;
    const r = await pool.request().query('SELECT * FROM tickets ORDER BY id_seq DESC');
    return (r.recordset || []).map(t => ({ 
      ...t, 
      createdBy: safeParse(t.createdBy), 
      notes: safeParse(t.notes, []), 
      history: safeParse(t.history, []) 
    }));
  },

  async getById(id) {
    const res = await this.get('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!res) return null;
    return { ...res, createdBy: safeParse(res.createdBy), notes: safeParse(res.notes, []), history: safeParse(res.history, []) };
  },

  async create(t) {
    const sqlStr = `INSERT INTO tickets (id, title, description, category, priority, status, area, location, asset, software, assignedTo, createdBy, phone, createdAt, updatedAt, notes, history) 
                  OUTPUT inserted.id_seq
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const finalId = t.id || `Ticket #${Date.now().toString().slice(-4)}`;
    const creator = (t.createdBy && t.createdBy.name) ? t.createdBy : { id: 'user-001', name: 'Usuario Portal', email: 'soporte@iceberg.com.co' };
    const params = [
      finalId, t.title || 'Sin título', t.description || '', t.category || 'otro', t.priority || 'baja', 
      t.status || 'abierto', t.area || 'General', t.location || '', t.asset || '', 
      t.software || '', t.assignedTo || 'Sin asignar', JSON.stringify(creator), 
      t.phone || '', t.createdAt || new Date().toISOString(), t.updatedAt || new Date().toISOString(), JSON.stringify(t.notes || []), 
      JSON.stringify(t.history || [])
    ];
    await this.run(sqlStr, params);
    return { ...t, id: finalId, createdBy: creator };
  },

  async update(id, patch) {
    const ex = await this.getById(id); if (!ex) return null;
    const u = { ...ex, ...patch };
    const sqlStr = `UPDATE tickets SET title=?, description=?, category=?, priority=?, status=?, area=?, location=?, asset=?, software=?, assignedTo=?, createdBy=?, notes=?, history=?, updatedAt=? WHERE id=?`;
    const params = [
      u.title, u.description, u.category, u.priority, u.status, u.area, u.location, u.asset, u.software, u.assignedTo,
      JSON.stringify(u.createdBy), JSON.stringify(u.notes), JSON.stringify(u.history), new Date().toISOString(), id
    ];
    await this.run(sqlStr, params);
    return u;
  },

  async addAuditLog(actor, action, targetId, details = '') {
    const sqlStr = `INSERT INTO audit_logs (actor, action, targetId, details) VALUES (?, ?, ?, ?)`;
    await this.run(sqlStr, [actor, action, targetId, details]);
  },

  async remove(id) {
    await this.run('DELETE FROM tickets WHERE id = ?', [id]);
  },

  isBackup() {
    return false;
  }
};

