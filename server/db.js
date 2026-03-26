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

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000,
  family: 4,
  retryWrites: true,
  w: 'majority'
})
  .then(() => console.log('✅ MongoDB conectado | Tickets/Notificaciones/Audit activos'))
  .catch(err => console.error('❌ ERROR CONEXIÓN MONGO:', err.message));

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

module.exports = {
  // ======= TICKETS =======
  async getAll() {
    return await Ticket.find({}).sort({ createdAt: -1 }).lean();
  },
  async getById(id) {
    return await Ticket.findOne({ id }).lean();
  },
  async create(t) {
    const ticket = new Ticket({ ...t, id: t.id || `T-${Date.now()}` });
    return await ticket.save();
  },
  async update(id, patch) {
    return await Ticket.findOneAndUpdate(
      { id },
      { ...patch, updatedAt: new Date() },
      { returnDocument: 'after' }
    ).lean();
  },
  async remove(id) {
    await Ticket.deleteOne({ id });
  },
  async removeAll() {
    await Ticket.deleteMany({});
  },

  // ======= NOTIFICACIONES =======
  async getNotifications(limit = 50) {
    return await Notification.find({}).sort({ timestamp: -1 }).limit(limit).lean();
  },
  async markNotificationRead(id) {
    await Notification.updateOne({ id }, { read: true });
  },
  async markAllNotificationsRead() {
    await Notification.updateMany({}, { read: true });
  },
  async createNotification(n) {
    const notif = new Notification({ ...n, id: n.id || `N-${Date.now()}` });
    await notif.save();
  },

  // ======= AUDIT =======
  async addAuditLog(actor, action, targetId, details = '') {
    const log = new AuditLog({ actor, action, targetId, details });
    await log.save();
  },
  async getAuditLogs(limit = 200) {
    return await AuditLog.find({}).sort({ timestamp: -1 }).limit(limit).lean();
  },

  isBackup() { return false; }
};
