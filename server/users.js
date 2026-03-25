'use strict';
const db   = require('./db');
const path = require('path');
const fs   = require('fs');

// Cargar lista maestra de correos corporativos
const CORREOS_PATH = path.join(__dirname, 'data', 'correos_iceberg.json');
let CORREOS_LIST = [];
try {
  const data = JSON.parse(fs.readFileSync(CORREOS_PATH, 'utf8'));
  CORREOS_LIST = (data.emails || []).map(e => e.toLowerCase().trim());
  console.log(`[USERS] ${CORREOS_LIST.length} correos corporativos cargados.`);
} catch (e) {
  console.warn('[USERS] No se pudo cargar correos_iceberg.json:', e.message);
}

// Path para persistir administradores autorizados
const ADMIN_EMAILS_PATH = path.join(__dirname, 'data', 'authorized_admins.json');
let IT_MASTERS = [
  'aprendiz.sistemas@iceberg.com.co',
  'soporte2@iceberg.com.co',
  'soporteti@iceberg.com.co',
  'gustavo.velandia@iceberg.com.co',
  'sistema.tickets@iceberg.com.co'
];

// Cargar persistencia
try {
  if (fs.existsSync(ADMIN_EMAILS_PATH)) {
    const data = JSON.parse(fs.readFileSync(ADMIN_EMAILS_PATH, 'utf8'));
    if (Array.isArray(data)) IT_MASTERS = data.map(e => e.toLowerCase().trim());
  }
} catch (e) {
  console.warn('[USERS] No se pudo cargar authorized_admins.json:', e.message);
}

function saveAdmins() {
  try {
    fs.writeFileSync(ADMIN_EMAILS_PATH, JSON.stringify(IT_MASTERS, null, 2));
  } catch (e) {
    console.error('[USERS] Error guardando authorized_admins.json:', e.message);
  }
}

const ADMIN_SEEDS = [
  { id: 'aprendiz.sistemas', name: 'Juan Ducuara', email: 'aprendiz.sistemas@iceberg.com.co', role: 'admin', area: 'Sistemas', password: 'Pdr48159' },
  { id: 'soporte2', name: 'Stiven Arevalo', email: 'soporte2@iceberg.com.co', role: 'admin', area: 'Sistemas', password: 'Sda48159' },
  { id: 'soporteti', name: 'Edgar Ducuara', email: 'soporteti@iceberg.com.co', role: 'admin', area: 'Sistemas', password: '~)ZExhpGQPW-' },
  { id: 'gustavo.velandia', name: 'Gustavo Velandia', email: 'gustavo.velandia@iceberg.com.co', role: 'admin', area: 'Sistemas', password: 'RA7ha?h=KET5' },
  { id: 'sistema.tickets', name: 'Sistema Ti', email: 'sistema.tickets@iceberg.com.co', role: 'admin', area: 'Sistemas', password: 'Pdr48159' }
];

class Users {
  static async initialize() {
    for (const admin of ADMIN_SEEDS) {
      try { await Users.create(admin); } catch (e) {}
    }
  }

  static async getByEmail(email) {
    if (!email) return null;
    const emailLow = email.toLowerCase().trim();
    try { return await db.get('SELECT * FROM users WHERE email = ?', [emailLow]); }
    catch (e) { return null; }
  }

  static async create({ id, name, email, password, role, area }) {
    if (!email) return null;
    const emailLow = email.toLowerCase().trim();
    const userId = id || emailLow.split('@')[0];
    const finalName = name || (emailLow.split('@')[0]);
    try {
      const exists = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (exists) {
        await db.run(`UPDATE users SET name = ?, email = ?, password = ?, role = ?, area = ? WHERE id = ?`,
                     [finalName, emailLow, password || null, role || 'user', area || 'General', userId]);
      } else {
        await db.run(`INSERT INTO users (id, name, email, password, role, area, active)
                     VALUES (?, ?, ?, ?, ?, ?, 1)`, 
                     [userId, finalName, emailLow, password || null, role || 'user', area || 'General']);
      }
    } catch (e) { console.error('[USERS CREATE ERR]', e.message); }
    return { id: userId, email: emailLow, name: finalName, role: role || 'user' };
  }

  static async getAll() {
    try { return await db.all('SELECT id, name, email, role, area, active FROM users'); }
    catch (e) { return []; }
  }

  static async count() {
    try {
      const row = await db.get('SELECT COUNT(*) as cnt FROM users');
      return row ? row.cnt : 0;
    } catch (e) { return 0; }
  }

  static async update(id, data) {
    try {
      const fields = [];
      const values = [];
      if (data.name)  { fields.push('name = ?');  values.push(data.name); }
      if (data.role)  { fields.push('role = ?');  values.push(data.role); }
      if (data.area)  { fields.push('area = ?');  values.push(data.area); }
      if (data.password) { fields.push('password = ?'); values.push(data.password); }
      if (fields.length === 0) return null;
      values.push(id);
      await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
      return await db.get('SELECT id, name, email, role, area, active FROM users WHERE id = ?', [id]);
    } catch (e) { return null; }
  }

  static async deactivate(id) {
    try { await db.run('UPDATE users SET active = 0 WHERE id = ?', [id]); }
    catch (e) { console.error('[USERS DEACTIVATE ERR]', e.message); }
  }

  static isCorporate(email) {
    if (!email) return false;
    const low = email.toLowerCase().trim();
    if (CORREOS_LIST.includes(low)) return true;
    return low.includes('iceberg') || low.includes('gezpo') || low.includes('@gezpomotor.com') || low.includes('@westlakecolombia.com') || low.includes('@fastrack.com.co');
  }

  static isMasterAdmin(email) {
    if (!email) return false;
    return IT_MASTERS.includes(email.toLowerCase().trim());
  }

  static getAdminEmails() {
    return [...IT_MASTERS];
  }

  static async addAdminEmail(email) {
    if (!email) return;
    const low = email.toLowerCase().trim();
    if (!IT_MASTERS.includes(low)) {
      IT_MASTERS.push(low);
      saveAdmins();
    }
  }

  static async removeAdminEmail(email) {
    if (!email) return;
    const low = email.toLowerCase().trim();
    const idx = IT_MASTERS.indexOf(low);
    if (idx >= 0) {
      IT_MASTERS.splice(idx, 1);
      saveAdmins();
    }
  }
}

module.exports = Users;
