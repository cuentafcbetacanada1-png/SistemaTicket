'use strict';
const db   = require('./db'); // Ahora es un objeto con modelos Mongoose
const path = require('path');
const fs   = require('fs');
const mongoose = require('mongoose');

// Definición de Esquemas Locales para asegurar el modelo
const User = mongoose.model('User');

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

try {
  if (fs.existsSync(ADMIN_EMAILS_PATH)) {
    const data = JSON.parse(fs.readFileSync(ADMIN_EMAILS_PATH, 'utf8'));
    if (Array.isArray(data)) IT_MASTERS = data.map(e => e.toLowerCase().trim());
  }
} catch (e) { }

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
      try { await Users.create(admin); } catch (e) { }
    }
    console.log('[USERS] ✅ Administradores sincronizados en MongoDB.');
  }

  static async getByEmail(email) {
    if (!email) return null;
    const emailLow = email.toLowerCase().trim();
    return await User.findOne({ email: emailLow }).lean();
  }

  static async create({ id, name, email, password, role, area }) {
    if (!email) return null;
    const emailLow = email.toLowerCase().trim();
    const userId = id || emailLow.split('@')[0];
    const finalName = name || (emailLow.split('@')[0]);
    
    const u = await User.findOneAndUpdate(
      { id: userId }, 
      { id: userId, name: finalName, email: emailLow, password: password || null, role: role || 'user', area: area || 'General', active: true },
      { upsert: true, new: true }
    ).lean();
    return u;
  }

  static async getAll() {
    return await User.find({}, 'id name email role area active').lean();
  }

  static async count() {
    return await User.countDocuments();
  }

  static async update(id, data) {
    return await User.findOneAndUpdate({ id }, data, { new: true }).lean();
  }

  static async deactivate(id) {
    await User.updateOne({ id }, { active: false });
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
}

module.exports = Users;
