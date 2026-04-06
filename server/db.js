'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PATHS = {
  tickets:       path.join(DATA_DIR, 'tickets.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  audit:         path.join(DATA_DIR, 'audit.json'),
  attachments:   path.join(DATA_DIR, 'attachments'),
  sequence:      path.join(DATA_DIR, 'sequence.json')
};

if (!fs.existsSync(PATHS.attachments)) fs.mkdirSync(PATHS.attachments, { recursive: true });

let dbCache = { tickets: null, notifications: null, audit: null, sequence: null };

function readJSON(file) {
  try {
    const key = Object.keys(PATHS).find(k => PATHS[k] === file);
    if (key && dbCache[key]) return JSON.parse(JSON.stringify(dbCache[key]));

    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (key) dbCache[key] = data;
    return JSON.parse(JSON.stringify(data));
  } catch (e) { console.error(`[DB-READ-ERR] ${file}:`, e.message); return []; }
}

function writeJSON(file, data) {
  try {
    const key = Object.keys(PATHS).find(k => PATHS[k] === file);
    if (key) dbCache[key] = data;

    fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if(err) console.error(`[DB-WRITE-ERR] ${file}:`, err.message);
    });
    return true;
  } catch (e) { console.error(`[DB-WRITE-ERR-SYNC] ${file}:`, e.message); return false; }
}

Object.values(PATHS).forEach(p => { 
  if (p === PATHS.attachments) return; 
  if (!fs.existsSync(p)) {
    if (p === PATHS.sequence) writeJSON(p, { nextId: 1 });
    else writeJSON(p, []); 
  }
});

console.log('✅ [DB] Modo Local JSON Activo | Persistencia en server/data/');

module.exports = {
  isConnected: () => true,
  isBackup: ()    => false,

  async getAll() {
    return readJSON(PATHS.tickets).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getById(id) {
    const all = readJSON(PATHS.tickets);
    return all.find(t => t.id === id) || null;
  },

  async create(t) {
    const all = readJSON(PATHS.tickets);
    
    const seq = readJSON(PATHS.sequence);
    const id = `#${seq.nextId || 1}`;
    seq.nextId = (seq.nextId || 1) + 1;
    writeJSON(PATHS.sequence, seq);

    const nuovo = { ...t, id, createdAt: t.createdAt || new Date().toISOString() };
    all.push(nuovo);
    writeJSON(PATHS.tickets, all);
    return nuovo;
  },

  async resetAll() {
    writeJSON(PATHS.tickets, []);
    writeJSON(PATHS.audit, []);
    writeJSON(PATHS.sequence, { nextId: 1 });
    try {
      const files = fs.readdirSync(PATHS.attachments);
      for (const file of files) {
        fs.unlinkSync(path.join(PATHS.attachments, file));
      }
    } catch(e) {}
  },

  async update(id, patch) {
    const all = readJSON(PATHS.tickets);
    const idx = all.findIndex(t => t.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    writeJSON(PATHS.tickets, all);
    return all[idx];
  },

  async remove(id) {
    const all = readJSON(PATHS.tickets);
    const filtered = all.filter(t => t.id !== id);
    writeJSON(PATHS.tickets, filtered);
  },

  async removeAll() {
    writeJSON(PATHS.tickets, []);
  },

  async getNotifications(limit = 50) {
    return readJSON(PATHS.notifications)
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  },

  async markNotificationRead(id) {
    const all = readJSON(PATHS.notifications);
    const n = all.find(x => x.id === id);
    if (n) { n.read = true; writeJSON(PATHS.notifications, all); }
  },

  async markAllNotificationsRead(userEmail, isAdmin) {
    const all = readJSON(PATHS.notifications);
    all.forEach(n => {
      if (n.userId === 'all') n.read = true;
      else if (n.userId === 'admin' && isAdmin) n.read = true;
      else if (n.userId === userEmail) n.read = true;
    });
    writeJSON(PATHS.notifications, all);
  },

  async createNotification(n) {
    const all = readJSON(PATHS.notifications);
    const nuovo = { 
      ...n, 
      id: n.id || `N-${Date.now()}`, 
      timestamp: n.timestamp || new Date().toISOString(),
      read: false 
    };
    all.push(nuovo);
    writeJSON(PATHS.notifications, all);
    return nuovo;
  },

  async addAuditLog(actor, action, targetId, details = '', snapshot = null) {
    const all = readJSON(PATHS.audit);
    all.push({ 
      actor, action, targetId, details, snapshot,
      timestamp: new Date().toISOString() 
    });
    if (all.length > 2000) all.shift();
    writeJSON(PATHS.audit, all);
  },

  async saveAttachment(id, file) {
    if (!file.data || !file.name) return null;
    try {
      const base64Data = file.data.includes('base64,') ? file.data.split('base64,')[1] : file.data;
      const buffer = Buffer.from(base64Data, 'base64');
      const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
      const filename = `${id}_${Date.now()}_${safeName}`;
      const fullPath = path.join(PATHS.attachments, filename);
      fs.writeFileSync(fullPath, buffer);
      return filename;
    } catch(e) {
      console.error('[DB-ATTACH-ERR]', e.message);
      return null;
    }
  },

  async getAuditLogs(limit = 400) {
    return readJSON(PATHS.audit).reverse().slice(0, limit);
  },

  resetAll: async function() {
    writeJSON(PATHS.tickets, []);
    writeJSON(PATHS.audit, []);
    writeJSON(PATHS.sequence, { nextId: 1 });
    try {
      const files = fs.readdirSync(PATHS.attachments);
      for (const file of files) {
        fs.unlinkSync(path.join(PATHS.attachments, file));
      }
    } catch(e) {}
  }
};
