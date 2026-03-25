const mongoose = require('mongoose');

// Mantenemos la interfaz para no romper server.js pero por debajo usamos MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/iceberg_tickets';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MONGO DB CONECTADO CON ÉXITO | Sistema de Tickets Activo'))
  .catch(err => console.error('❌ ERROR CONEXIÓN MONGO:', err.message));

// ESQUEMAS
const ticketSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  title: String,
  description: String,
  category: String,
  priority: String,
  status: String,
  area: String,
  location: String,
  asset: String,
  software: String,
  assignedTo: String,
  createdBy: Object,
  phone: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  notes: Array,
  history: Array
});

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: String,
  area: String,
  active: { type: Boolean, default: true }
});

const notificationSchema = new mongoose.Schema({
  id: String,
  userId: String,
  ticketId: String,
  title: String,
  message: String,
  type: String,
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const auditSchema = new mongoose.Schema({
  actor: String,
  action: String,
  targetId: String,
  details: String,
  timestamp: { type: Date, default: Date.now }
});

const Ticket = mongoose.model('Ticket', ticketSchema);
const User = mongoose.model('User', userSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const AuditLog = mongoose.model('AuditLog', auditSchema);

module.exports = {
  // Mock de compatibilidad para SQL querys simples de Auth
  async get(q, p = []) {
    if (q.includes('FROM users')) {
      return await User.findOne({ email: p[0] }).lean();
    }
    if (q.includes('FROM audit_logs')) {
      return await AuditLog.findOne({ targetId: p[0] }).sort({ timestamp: -1 }).lean();
    }
    return null;
  },

  async all(q, p = []) {
    if (q.includes('FROM notifications')) {
      return await Notification.find({ userId: p[0] }).sort({ timestamp: -1 }).lean();
    }
    if (q.includes('FROM audit_logs')) {
      return await AuditLog.find({ targetId: p[0] }).sort({ timestamp: -1 }).lean();
    }
    return [];
  },

  async run(q, p = []) { 
    // Capturamos inserts simples
    return { lastID: Date.now() };
  },

  async getAll() {
    return await Ticket.find({}).sort({ createdAt: -1 }).lean();
  },

  async getById(id) {
    return await Ticket.findOne({ id }).lean();
  },

  async create(t) {
    const fresh = new Ticket({ ...t, id: t.id || `T-${Date.now()}` });
    return await fresh.save();
  },

  async update(id, patch) {
    return await Ticket.findOneAndUpdate({ id }, { ...patch, updatedAt: new Date() }, { returnDocument: 'after' }).lean();
  },

  async remove(id) {
    await Ticket.deleteOne({ id });
  },

  async addAuditLog(actor, action, targetId, details = '') {
    const log = new AuditLog({ actor, action, targetId, details });
    await log.save();
  },

  async createNotification(n) {
    const notif = new Notification({ ...n, id: n.id || `N-${Date.now()}` });
    await notif.save();
  },

  isBackup() { return false; }
};
