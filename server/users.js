'use strict';
const xlsx = require('xlsx');
const path = require('path');
const fs   = require('fs');

// =====================================================================
// USUARIOS: Se leen ÚNICAMENTE del Excel en memoria al arrancar.
// MongoDB NO se usa para usuarios.
// =====================================================================

const EXCEL_PATH = path.join(__dirname, 'data', 'CorreosIceberg 2026.xlsx');
const ADMIN_EMAILS_PATH = path.join(__dirname, 'data', 'authorized_admins.json');

// Admins con contraseña (4 administradores del equipo IT)
const ADMIN_SEEDS = [
  { id: 'aprendiz.sistemas',  name: 'Juan Ducuara',     email: 'aprendiz.sistemas@iceberg.com.co', role: 'admin', empresa: 'Transportes Iceberg', password: 'Pdr48159',      active: true },
  { id: 'soporte2',           name: 'Stiven Arevalo',   email: 'soporte2@iceberg.com.co',           role: 'admin', empresa: 'Transportes Iceberg', password: 'Sda48159',      active: true },
  { id: 'soporteti',          name: 'Edgar Ducuara',    email: 'soporteti@iceberg.com.co',          role: 'admin', empresa: 'Transportes Iceberg', password: '~)ZExhpGQPW-', active: true },
  { id: 'gustavo.velandia',   name: 'Gustavo Velandia', email: 'gustavo.velandia@iceberg.com.co',   role: 'admin', empresa: 'Transportes Iceberg', password: 'RA7ha?h=KET5', active: true },
];

// ---- Cargar y parsear el Excel ----
let ALL_USERS = []; // Array de {id, name, email, role, empresa, active, password}

function loadExcel() {
  try {
    const workbook = xlsx.readFile(EXCEL_PATH);
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = xlsx.utils.sheet_to_json(sheet);

    const adminEmails = new Set(ADMIN_SEEDS.map(a => a.email.toLowerCase()));

    ALL_USERS = rows
      .map(row => {
        const email   = (row['Email']       || row['email']       || '').toString().replace(/[\r\n]/g, '').toLowerCase().trim();
        const nombre  = (row['Observacion'] || row['Observación'] || row['Nombre'] || row['nombre'] || '').toString().replace(/[\r\n]/g, '').trim();
        const empresa = (row['Empresa']     || row['empresa']     || 'General').toString().replace(/[\r\n]/g, '').trim();
        const estado  = (row['Estado']      || row['estado']      || 'ACTIVO').toString().toUpperCase().trim();
        if (!email || !email.includes('@')) return null;
        return {
          id:      email.split('@')[0],
          name:    nombre || email.split('@')[0],
          email,
          role:    'user',
          empresa,
          active:  estado === 'ACTIVO',
          password: null
        };
      })
      .filter(u => u && !adminEmails.has(u.email)); // excluir admins (ya están en ADMIN_SEEDS)

    // Agregar admins al principio
    ALL_USERS = [...ADMIN_SEEDS, ...ALL_USERS];
    console.log(`[USERS] ✅ ${ALL_USERS.length} usuarios cargados desde Excel (${ADMIN_SEEDS.length} admins + ${ALL_USERS.length - ADMIN_SEEDS.length} corporativos).`);
  } catch (e) {
    console.warn('[USERS] ⚠️  No se pudo leer el Excel, usando solo admins hardcoded:', e.message);
    ALL_USERS = [...ADMIN_SEEDS];
  }
}

loadExcel(); // Ejecutar al arrancar el servidor

// ---- Lista de administradores autorizados (para login Microsoft) ----
let IT_MASTERS = ADMIN_SEEDS.map(a => a.email);
try {
  if (fs.existsSync(ADMIN_EMAILS_PATH)) {
    const data = JSON.parse(fs.readFileSync(ADMIN_EMAILS_PATH, 'utf8'));
    if (Array.isArray(data)) IT_MASTERS = data.map(e => e.toLowerCase().trim());
  }
} catch (e) { }

// =====================================================================
// API de Usuarios (todo en memoria, sin MongoDB)
// =====================================================================
class Users {

  // Inicialización (no necesita hacer nada con la BD para usuarios)
  static async initialize() {
    console.log('[USERS] ✅ Sistema de usuarios listo (modo Excel).');
  }

  static async getByEmail(email) {
    if (!email) return null;
    const low = email.toLowerCase().trim();
    return ALL_USERS.find(u => u.email === low) || null;
  }

  static async create({ email, name, role }) {
    // Los usuarios ya están en el Excel — solo devolvemos el existente o uno temporal
    const existing = await Users.getByEmail(email);
    if (existing) return existing;
    // Usuario temporal en memoria (no se persiste, solo para la sesión)
    return { id: email.split('@')[0], name: name || email.split('@')[0], email: email.toLowerCase(), role: role || 'user', empresa: 'General', active: true };
  }

  static async getAll() {
    return ALL_USERS.map(({ password: _pw, ...u }) => u); // Ocultar contraseñas
  }

  static async count() {
    return ALL_USERS.length;
  }

  static async update(id, data) {
    const idx = ALL_USERS.findIndex(u => u.id === id || u.email === id);
    if (idx >= 0) {
      ALL_USERS[idx] = { ...ALL_USERS[idx], ...data };
      return ALL_USERS[idx];
    }
    return null;
  }

  static async deactivate(id) {
    const u = ALL_USERS.find(u => u.id === id || u.email === id);
    if (u) u.active = false;
  }

  static isCorporate(email) {
    if (!email) return false;
    const low = email.toLowerCase().trim();
    // Buscar en el Excel primero
    if (ALL_USERS.some(u => u.email === low)) return true;
    // Fallback por dominio
    return (
      low.endsWith('@iceberg.com.co') ||
      low.endsWith('@gezpomotor.com') ||
      low.endsWith('@westlakecolombia.com') ||
      low.endsWith('@fastrack.com.co') ||
      low.endsWith('@gezport.com')
    );
  }

  static isMasterAdmin(email) {
    if (!email) return false;
    return IT_MASTERS.includes(email.toLowerCase().trim());
  }

  static getAdminEmails() {
    return [...IT_MASTERS];
  }

  static addAdminEmail(email) {
    if (!email) return;
    const low = email.toLowerCase().trim();
    if (!IT_MASTERS.includes(low)) {
      IT_MASTERS.push(low);
      try { fs.writeFileSync(ADMIN_EMAILS_PATH, JSON.stringify(IT_MASTERS, null, 2)); } catch (e) {}
    }
  }

  static removeAdminEmail(email) {
    if (!email) return;
    const low = email.toLowerCase().trim();
    IT_MASTERS = IT_MASTERS.filter(e => e !== low);
    try { fs.writeFileSync(ADMIN_EMAILS_PATH, JSON.stringify(IT_MASTERS, null, 2)); } catch (e) {}
  }

  static getAdminSeeds() {
    return ADMIN_SEEDS;
  }
}

module.exports = Users;
