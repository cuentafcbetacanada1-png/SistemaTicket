'use strict';
const mongoose = require('mongoose');

// Prioridad: MONGODB_URL (Railway interno) > DATABASE_URL (Railway público) > MONGO_URL (local) > localhost
const MONGO_URI =
  process.env.MONGODB_URL ||
  process.env.DATABASE_URL ||
  process.env.MONGO_URL ||
  'mongodb://localhost:27017/iceberg_tickets';

const safeHost = MONGO_URI.replace(/\/\/[^@]+@/, '//***@');
console.log('[DB] Conectando a:', safeHost);

// ── bufferCommands: false → operaciones fallan INMEDIATAMENTE si no hay conexión
// ── no se quedan bloqueadas esperando 30s
mongoose.set('bufferCommands', false);

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,   // Falla rápido si MongoDB no responde (era 15s)
  socketTimeoutMS: 15000,
  connectTimeoutMS: 8000,
  family: 4,
  retryWrites: true,
  w: 'majority'
})
  .then(() => console.log('✅ MongoDB conectado | Tickets/Notificaciones/Audit activos'))
  .catch(err => console.error('❌ ERROR CONEXIÓN MONGO:', err.message));

// Reconexión silenciosa: evitar que los errores de reconexión hagan ruido
mongoose.connection.on('error', err => console.error('[DB] Error de conexión:', err.message));
mongoose.connection.on('disconnected', () => console.warn('[DB] MongoDB desconectado, reintentando...'));
mongoose.connection.on('reconnected', () => console.log('[DB] ✅ MongoDB reconectado'));

// =====================================================================
// ESQUEMAS — Solo Tickets, Notificaciones y Audit (Usuarios = Excel)
// =====================================================================

const ticketSchema = new mongoose.Schema({
  id:          { type: String, unique: true },
  title:       String,
  description: String,
  category:    String,
  priority:    String,
  status:      String,
  area:        String,
  location:    String,
  asset:       String,
  software:    String,
  assignedTo:  String,
  createdBy:   Object,
  phone:       String,
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
  notes:       { type: Array, default: [] },
  history:     { type: Array, default: [] }
});

const notificationSchema = new mongoose.Schema({
  id:        { type: String, unique: true },
  userId:    String,
  ticketId:  String,
  title:     String,
  message:   String,
  type:      String,
  timestamp: { type: Date, default: Date.now },
  read:      { type: Boolean, default: false }
});

const auditSchema = new mongoose.Schema({
  actor:     String,
  action:    String,
  targetId:  String,
  details:   String,
  timestamp: { type: Date, default: Date.now }
});

const Ticket       = mongoose.models.Ticket       || mongoose.model('Ticket',       ticketSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
const AuditLog     = mongoose.models.AuditLog     || mongoose.model('AuditLog',     auditSchema);

// Helper: chequea si MongoDB está conectado antes de operar
function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  isConnected,

  // ======= TICKETS =======
  async getAll() {
    if (!isConnected()) return [];
    try { return await Ticket.find({}).sort({ createdAt: -1 }).lean(); }
    catch (e) { console.error('[DB] getAll error:', e.message); return []; }
  },
  async getById(id) {
    if (!isConnected()) return null;
    try { return await Ticket.findOne({ id }).lean(); }
    catch (e) { return null; }
  },
  async create(t) {
    if (!isConnected()) throw new Error('Base de datos no disponible. Reintenta en unos segundos.');
    const ticket = new Ticket({ ...t, id: t.id || `T-${Date.now()}` });
    return await ticket.save();
  },
  async update(id, patch) {
    if (!isConnected()) return null;
    try {
      return await Ticket.findOneAndUpdate(
        { id },
        { ...patch, updatedAt: new Date() },
        { returnDocument: 'after' }
      ).lean();
    } catch (e) { return null; }
  },
  async remove(id) {
    if (!isConnected()) return;
    try { await Ticket.deleteOne({ id }); } catch (e) {}
  },
  async removeAll() {
    if (!isConnected()) return;
    try { await Ticket.deleteMany({}); } catch (e) {}
  },

  // ======= NOTIFICACIONES =======
  async getNotifications(limit = 50) {
    if (!isConnected()) return [];
    try { return await Notification.find({}).sort({ timestamp: -1 }).limit(limit).lean(); }
    catch (e) { return []; }
  },
  async markNotificationRead(id) {
    if (!isConnected()) return;
    try { await Notification.updateOne({ id }, { read: true }); } catch (e) {}
  },
  async markAllNotificationsRead() {
    if (!isConnected()) return;
    try { await Notification.updateMany({}, { read: true }); } catch (e) {}
  },
  async createNotification(n) {
    if (!isConnected()) return; // silencioso cuando BD está caída
    try {
      const notif = new Notification({ ...n, id: n.id || `N-${Date.now()}` });
      await notif.save();
    } catch (e) {}
  },

  // ======= AUDIT =======
  async addAuditLog(actor, action, targetId, details = '') {
    if (!isConnected()) return; // silencioso cuando BD está caída
    try {
      const log = new AuditLog({ actor, action, targetId, details });
      await log.save();
    } catch (e) {}
  },
  async getAuditLogs(limit = 200) {
    if (!isConnected()) return [];
    try { return await AuditLog.find({}).sort({ timestamp: -1 }).limit(limit).lean(); }
    catch (e) { return []; }
  },

  isBackup() { return false; }
};
