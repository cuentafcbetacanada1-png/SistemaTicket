'use strict';
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('[ENV] Buscando variables en:', path.join(__dirname, '..', '.env'), fs.existsSync(path.join(__dirname, '..', '.env')) ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');

const express = require('express');
const cors = require('cors');
const https = require('https');
const db = require('./db');
const nodemailer = require('nodemailer');
const Users = require('./users');

const app = express();
const PORT = process.env.PORT || 3000;

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  connectionTimeout: 10000,
  tls: { rejectUnauthorized: true }
}, {
  from: `"Iceberg Support" <${process.env.EMAIL_USER}>`
});

async function getMicrosoftToken() {
  const clean = (val) => (val || '').trim().replace(/^["'=]+|["']+$/g, '');
  const tenantId = clean(process.env.AZURE_TENANT_ID);
  const clientId = clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = clean(process.env.AZURE_CLIENT_SECRET);

  const body = `client_id=${clientId}&client_secret=${clientSecret}&scope=https://graph.microsoft.com/.default&grant_type=client_credentials`;
  const options = {
    hostname: 'login.microsoftonline.com',
    port: 443,
    path: `/${tenantId}/oauth2/v2.0/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let bodyData = '';
      res.on('data', (d) => { bodyData += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(bodyData).access_token); } catch (e) { resolve(null); }
        } else {
          console.error(`[MS-GRAPH AUTH ERR] ${res.statusCode}: ${bodyData}`);
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendMailMicrosoftGraph(mailOptions) {
  try {
    const clean = (val) => (val || '').trim().replace(/^["'=]+|["']+$/g, '');
    const recipients = Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to];
    const emailUser = clean(process.env.EMAIL_USER);
    const token = await getMicrosoftToken();
    const attachments = (mailOptions.attachments || []).map(a => {
      let contentBytes = '';
      if (a.path) {
        try { contentBytes = fs.readFileSync(a.path).toString('base64'); } catch (e) { return null; }
      } else if (a.content) {
        contentBytes = Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64');
      } else if (typeof a.data === 'string' && a.data.includes('base64,')) {
        contentBytes = a.data.split('base64,')[1];
      }

      if (!contentBytes) return null;
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename || 'attachment',
        contentBytes: contentBytes,
        isInline: !!a.cid,
        contentId: a.cid || null
      };
    }).filter(x => x !== null);

    const data = JSON.stringify({
      message: {
        subject: mailOptions.subject,
        body: { contentType: 'HTML', content: mailOptions.html },
        toRecipients: recipients.map(e => ({ emailAddress: { address: e.trim() } })),
        attachments: attachments
      }
    });
    const options = {
      hostname: 'graph.microsoft.com',
      port: 443,
      path: `/v1.0/users/${emailUser}/sendMail`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    return await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let resBody = '';
        res.on('data', (d) => { resBody += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[MS-GRAPH] ✅ Enviado exitosamente a: ${recipients.join(', ')}`);
            resolve([{ recipients, success: true }]);
          } else {
            console.error(`[MS-GRAPH ERR] Status ${res.statusCode}: ${resBody}`);
            resolve(null);
          }
        });
      });
      req.on('error', (e) => { 
        console.error(`[MS-GRAPH ERR] Error de red/petición: ${e.message}`); 
        resolve(null); 
      });
      req.write(data); req.end();
    });
  } catch (e) { 
    console.error(`[MS-GRAPH CATCH] Error fatal en sendMailMicrosoftGraph: ${e.message}`); 
    return null; 
  }
}

async function sendMailResilient(mailOptions) {
  try {
    const recipients = Array.isArray(mailOptions.to) ? mailOptions.to.filter(r => r && typeof r === 'string' && r.includes('@')) : [mailOptions.to];
    if (recipients.length === 0) {
      console.warn('[MAIL-FLOW] ⚠️ No hay destinatarios válidos. Abortando envío.');
      return null;
    }
    console.log(`[MAIL-FLOW] ✉️ Iniciando envío para ${recipients.length} usuario(s): ${recipients.join(', ')}`);

    if (process.env.AZURE_CLIENT_SECRET) {
      console.log(`[MAIL-FLOW] → Intentando vía Microsoft Graph API...`);
      try {
        const result = await sendMailMicrosoftGraph(mailOptions);
        if (result) return result;
      } catch (e) {
        console.warn(`[MAIL-FLOW] ! Error en Microsoft Graph API: ${e.message}`);
      }
    }

    if (process.env.SENDGRID_API_KEY) {
      console.log(`[MAIL-FLOW] → Intentando vía SendGrid API...`);
      try {
        const data = JSON.stringify({
          personalizations: [{ to: recipients.map(email => ({ email: email.trim() })) }],
          from: { email: process.env.EMAIL_USER, name: 'Iceberg Support' },
          subject: mailOptions.subject,
          content: [{ type: 'text/html', value: mailOptions.html }]
        });
        const options = {
          hostname: 'api.sendgrid.com',
          port: 443,
          path: '/v3/mail/send',
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        const sgResult = await new Promise((resolve) => {
          const req = https.request(options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log(`[SENDGRID] ✅ Enviado a: ${recipients.join(', ')}`);
              resolve([{ recipients, success: true }]);
            } else { resolve(null); }
          });
          req.on('error', () => resolve(null));
          req.write(data); req.end();
        });
        if (sgResult) return sgResult;
      } catch (e) { console.warn(`[MAIL-FLOW] ! Error en SendGrid: ${e.message}`); }
    }

    console.log(`[MAIL-FLOW] → Intentando vía SMTP Tradicional (Fallback)...`);
    return await fallbackSMTP(mailOptions, recipients);
  } catch (e) {
    console.error(`[MAIL-FLOW CRITICAL] Error inesperado en el motor de correo: ${e.message}`);
    return null;
  }
}

async function fallbackSMTP(mailOptions, recipients) {
  const promises = recipients.map(async (recipient) => {
    try {
      await transporter.sendMail({ ...mailOptions, to: recipient });
      console.log(`[SMTP-OLD] OK: ${recipient}`);
      return { recipient, success: true };
    } catch (err) {
      console.error(`[SMTP-OLD ERR] ${recipient}:`, err.message);
      return { recipient, success: false, error: err.message };
    }
  });
  return Promise.all(promises);
}

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo-iceberg.png');
const EMAIL_ATTACHMENTS = fs.existsSync(LOGO_PATH) ? [{
  filename: 'logo-iceberg.png',
  path: LOGO_PATH,
  cid: 'logo'
}] : [];

const ADMIN_RECIPIENTS = Users.getAdminEmails();
console.log(`[MAIL-CONFIG] Administradores de destino: ${ADMIN_RECIPIENTS.length}`);

transporter.verify((err) => {
  if (err) console.error('[SMTP ERROR] No se pudo verificar conexión:', err.message);
  else console.log('[SMTP READY] ✅ Conectado a Office365.');
});


const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  const sensitiveFiles = ['.env', '.gitignore', '.vscode', '.git', '.json', '.txt'];
  const sourceFiles = ['.js', '.css', '.html'];
  const emailLow = (req.path || '').toLowerCase();

  if (sensitiveFiles.includes(ext) || emailLow.includes('/package.json') || emailLow.includes('/.env') || emailLow.includes('/.git')) {
    if (req.path !== '/health' && req.path !== '/') {
      return res.status(403).json({ error: 'System policy: Restricted access' });
    }
  }

  if (sourceFiles.includes(ext)) {
    const isDirectNav = req.headers['sec-fetch-dest'] === 'document' ||
      req.headers['sec-fetch-mode'] === 'navigate' ||
      (req.headers.accept && req.headers.accept.includes('text/html'));

    const isRoot = req.path === '/' || req.path === '/index.html';

    if (!isRoot && (isDirectNav || !req.headers.referer)) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Acceso Restringido - Transportes Iceberg</title>
          <style>
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1e293b; }
            .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); max-width: 450px; text-align: center; border: 1px solid #e2e8f0; }
            .icon { font-size: 48px; margin-bottom: 20px; }
            h1 { font-size: 24px; margin-bottom: 12px; color: #0f172a; }
            p { font-size: 15px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
            .btn { background: #335495; color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; display: inline-block; transition: all 0.2s; }
            .btn:hover { background: #2563eb; transform: translateY(-1px); }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🛡️</div>
            <h1>Acceso Restringido</h1>
            <p>Por políticas de seguridad empresarial, el acceso directo a los componentes internos del sistema está bloqueado.<br><br>Por favor, utilice el portal oficial de Transportes Iceberg para sus solicitudes.</p>
            <a href="/" class="btn">Ir al Portal Oficial</a>
          </div>
        </body>
        </html>
      `);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '..')));

app.get('/health', (req, res) => res.json({
  status: 'ok',
  stable: true,
  v: '9.6 (LocalJSON/StaffSync)',
  dbConnected: db.isConnected(),
  dbMode: 'Local File System (JSON)',
  timestamp: new Date().toISOString()
}));


app.get('/tickets', async (req, res) => {
  try { res.json(await db.getAll()); } catch (e) { res.status(500).json({ error: e.message }); }
});

const renderEmail = (t, title, subtitle, badgeText, badgeColor = '#335495', contentHtml = '', isHighPriority = false) => `
    <div style="background-color: #f1f5f9; padding: 30px 10px; font-family: 'Segoe UI', Arial, sans-serif;">
      <table align="center" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; border-collapse: separate;">
        <tr>
          <td style="padding: 25px 40px; border-bottom: 2px solid #f1f5f9;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td><img src="cid:logo" alt="Logo" style="height: 35px; display: block;"></td>
                <td align="right">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background-color: ${badgeColor}; color: #ffffff; padding: 6px 14px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase;">${badgeText}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color: #0f172a; padding: 45px 40px; color: #ffffff;">
            <div style="font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 12px;">${subtitle}</div>
            <div style="font-size: 26px; font-weight: bold; line-height: 1.3;">${isHighPriority ? '🚩 ' : ''}${title}</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px;">
            <div style="font-size: 15px; color: #334155; line-height: 1.6; margin-bottom: 30px;">${contentHtml}</div>
            <div style="margin-top: 40px; padding-top: 30px; border-top: 1px solid #f1f5f9; text-align: center;">
              <a href="https://sistema-tickets.up.railway.app?ticketId=${encodeURIComponent(t.id)}" style="background-color: #335495; color: #ffffff; padding: 15px 35px; border-radius: 6px; font-weight: bold; text-decoration: none; display: inline-block; font-size: 14px;">Ir a Gestión de Soporte →</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 1px solid #f1f5f9;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: bold; letter-spacing: 1px;">Transportes Iceberg Colombia S.A. • SISTEMA DE SOPORTE</div>
          </td>
        </tr>
      </table>
    </div>`;

const getGridTable = (t) => {
  const attachHtml = t.attachments && t.attachments.length > 0
    ? t.attachments.map(a => {
      if (a.type && a.type.startsWith('image/')) {
        return `<div style="display:inline-block; margin-right:15px; margin-top:15px; vertical-align:top; text-align:center;">
                      <div style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; box-shadow:0 6px 15px rgba(0,0,0,0.1); background:#ffffff; margin-bottom:8px;">
                        <img src="${a.data}" style="height:180px; width:auto; display:block;" alt="adjunto">
                      </div>
                      <a href="https://sistema-tickets.up.railway.app?ticketId=${encodeURIComponent(t.id)}" style="color:#2563eb; font-size:12px; font-weight:bold; text-decoration:none; background:#f1f5f9; padding:6px 12px; border-radius:20px; border:1px solid #e2e8f0; display:inline-block;">🔍 VER Y AMPLIAR EN PORTAL</a>
                    </div>`;
      }
      return `<div style="display:inline-block; margin-right:8px; margin-top:8px; padding:6px 12px; background:#f1f5f9; border-radius:6px; font-size:11px; color:#475569; border:1px solid #e2e8f0; vertical-align:top;">📎 ${a.name}</div>`;
    }).join('')
    : '<span style="color:#94a3b8; font-style:italic;">Sin archivos</span>';

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: separate; font-size: 13px; overflow: hidden;">
      <tr>
        <td width="55%" style="padding: 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; background-color: #fafafa;">
          <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">Asunto</div>
          <div style="font-weight: bold; color: #0f172a;">${t.title}</div>
        </td>
        <td width="45%" style="padding: 15px; border-bottom: 1px solid #e2e8f0;">
          <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">Categoría</div>
          <div style="font-weight: bold;">${t.category}</div>
        </td>
      </tr>
      <tr>
        <td width="55%" style="padding: 15px; border-right: 1px solid #e2e8f0;">
          <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">Solicitante</div>
          <div style="font-weight: bold;">${t.createdBy.name}</div>
        </td>
        <td width="45%" style="padding: 15px; background-color: #fafafa;">
          <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">Prioridad</div>
          <div style="font-weight: bold; color: ${t.priority === 'critica' ? '#dc2626' : '#1e293b'};">${t.priority.toUpperCase()}</div>
        </td>
      </tr>
    </table>
    <div style="margin-top: 25px;">
      <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 8px;">Mensaje Detallado</div>
      <div style="background-color: #f8fafc; padding: 20px; border-radius: 6px; color: #334155; border-left: 4px solid #335495; font-size: 14px;">${t.description || 'Sin descripción'}</div>
    </div>
    <div style="margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
      <div style="font-size: 9px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 8px;">Evidencias Adjuntas</div>
      <div style="line-height: 0;">${attachHtml}</div>
    </div>`;
};

app.post('/tickets', async (req, res) => {
  try {
    const actor = req.headers['iceberg-user'] || 'Usuario Portal';

    let realName = actor;
    try {
      const uInfo = Users.getByEmail(actor);
      if (uInfo && uInfo.name) realName = uInfo.name;
    } catch (e) { }

    let createdBy = req.body.createdBy;
    if (!createdBy || !createdBy.name || createdBy.name === 'Sistema' || createdBy.name === 'Usuario Corporativo') {
      createdBy = {
        id: actor.includes('@') ? actor.split('@')[0] : 'user-001',
        name: realName,
        email: actor.includes('@') ? actor : (req.body.createdBy?.email || '')
      };
    }

    const tData = {
      ...req.body,
      id: req.body.id || `Ticket #${Date.now().toString().slice(-4)}`,
      status: req.body.status || 'abierto',
      title: req.body.title || 'Sin título',
      description: req.body.description || req.body.title || 'Sin descripción',
      createdBy,
      createdAt: req.body.createdAt || new Date().toISOString(),
      updatedAt: req.body.updatedAt || new Date().toISOString(),
      notes: req.body.notes || [],
      history: req.body.history || []
    };

    const t = await db.create(tData);

    if (t.attachments && t.attachments.length > 0) {
      for (const a of t.attachments) {
        await db.saveAttachment(t.id, a);
      }
    }

    await db.addAuditLog(actor, 'CREAR_TICKET', t.id, `Ticket "${t.title}" reportado por ${t.createdBy.name}`, t);

    res.status(201).json(t);

    (async () => {
       try {
          await createNotification(
            `Nuevo Ticket: ${t.id}`,
            `${t.createdBy.name} ha reportado: ${t.title}`,
            t.id, 'admin', 'info'
          );

          const adminMail = {
            to: ADMIN_RECIPIENTS,
            subject: `Solicitud #${t.id} de IT Portal`,
            html: renderEmail(t, `Nueva solicitud técnica`, `NOTIFICACIÓN TI`, `NUEVA`, '#335495',
              `<p>Se ha registrado un caso con ID <strong>${t.id}</strong>.</p>${getGridTable(t)}`),
            attachments: [
              ...EMAIL_ATTACHMENTS,
              ...(t.attachments || []).map(a => ({
                filename: a.name,
                data: a.data,
                type: a.type
              }))
            ]
          };
          console.log(`[MAIL-FLOW] 🆕 Enviando alerta de nuevo ticket a administradores.`);
          await sendMailResilient(adminMail);
       } catch (err) {
          console.error('[POST-TICKET-NOTIF-ERR]', err);
       }
    })();
  } catch (e) { 
    console.error('[POST-TICKET-ERR]', e);
    res.status(500).json({ error: e.message }); 
  }
});

app.put('/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.headers['iceberg-user'] || 'Desconocido';
    const old = await db.getById(id);
    const updated = await db.update(id, req.body);

    if (updated && old) {
      if (old.status !== updated.status) {
        await db.addAuditLog(actor, 'CAMBIO_ESTADO', id, `De ${old.status} a ${updated.status}`);
      }
      if (old.assignedTo !== updated.assignedTo) {
        await db.addAuditLog(actor, 'ASIGNAR_TECNICO', id, `Asignado a: ${updated.assignedTo}`);
      }
    }

    const isNoteAdded = (old.notes || []).length !== (updated.notes || []).length;
    const isHistoryAdded = (old.history || []).length !== (updated.history || []).length;
    res.json(updated);
    
    (async () => {  
      try {
        if (updated && old && (old.status !== updated.status || old.assignedTo !== updated.assignedTo || isNoteAdded || isHistoryAdded)) {
          console.log(`[MAIL-FLOW] Operación detectada en #${id}. Analizando notificaciones...`);
          const isStatusChange = old.status !== updated.status;
          const isAssignChange = old.assignedTo !== updated.assignedTo;
          const statusLabel = { 'abierto': 'ABIERTO', 'en-progreso': 'EN PROGRESO', 'resuelto': 'RESUELTO', 'cerrado': 'CERRADO' }[updated.status] || updated.status.toUpperCase();
          
          let subject = `📢 Actualización: #${updated.id}`;
          let htmlIntro = `<p>El ticket <strong>#${updated.id}</strong> ha recibido una nueva actualización por <strong>${actor}</strong>.</p>`;
          let msg = `El ticket fue actualizado.`;
          
          if (isAssignChange) {
             subject = `🛠️ Asignación: #${updated.id}`;
             htmlIntro = `<p>El ticket <strong>#${updated.id}</strong> ha sido asignado a <strong>${updated.assignedTo}</strong> por <strong>${actor}</strong>.</p>`;
             msg = `Asignado a: ${updated.assignedTo}`;
          } else if (isStatusChange) {
             subject = `📢 Cambio de Estado: #${updated.id} → ${statusLabel}`;
             htmlIntro = `<p>El ticket <strong>#${updated.id}</strong> ha cambiado de estado a <strong>${statusLabel}</strong> por <strong>${actor}</strong>.</p>`;
             msg = `Estado cambiado a: ${statusLabel}`;
          } else if (isNoteAdded) {
             subject = `💬 Nuevo Comentario: #${updated.id}`;
             msg = `Nuevo comentario de ${actor}`;
          }

          const adminList = Users.getAdminEmails();
          const emailSet = new Set(adminList.map(e => e.toLowerCase().trim()));
          if (updated.createdBy && updated.createdBy.email) {
              const creatorEmail = updated.createdBy.email.toLowerCase().trim();
              if (creatorEmail && creatorEmail !== 'anon@iceberg.com.co') emailSet.add(creatorEmail);
          }
          
          // No enviar correos a destinatarios vacíos
          const finalRecipients = Array.from(emailSet).filter(e => e && e.includes('@'));
          if (finalRecipients.length === 0) {
              console.warn('[MAIL-FLOW] No hay recipientes válidos para esta actualización. Abortando.');
              return;
          }

          
          const mailBody = renderEmail(updated, 
             isAssignChange ? `Técnico asignado: ${updated.assignedTo}` : (isNoteAdded ? 'Nuevo Comentario' : `Nuevo estado: ${statusLabel}`), 
             `CONTROL TI`, 
             isAssignChange ? 'ASIGNACIÓN' : statusLabel, 
             '#0f172a',
             htmlIntro + `<br/>` + getGridTable(updated)
          );

          const broadcastMail = {
            to: Array.from(emailSet),
            subject: subject,
            html: mailBody,
            attachments: EMAIL_ATTACHMENTS
          };
          
          console.log(`[MAIL-FLOW] 🚀 Despachando a ${finalRecipients.length} correos via motor resiliente.`);
          await sendMailResilient({ ...broadcastMail, to: finalRecipients });


          await createNotification(`Actualización #${updated.id}`, msg, updated.id, updated.createdBy?.email || 'all', 'info');
          await createNotification(`Actualización #${updated.id}`, msg, updated.id, 'admin', 'info');
        }
      } catch (innerErr) {
        console.error('[MAIL-FLOW BACKGROUND ERR]', innerErr);
      }
    })();

  } catch (e) { 
    console.error('[PUT-TICKET-ERR]', e);
    res.status(500).json({ error: e.message }); 
  }
});

app.delete('/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.headers['iceberg-user'] || 'Admin';
    const t = await db.getById(id);
    if (t) {
      await db.addAuditLog(actor, 'ELIMINAR_TICKET', id, `Ticket "${t.title}" de ${t.createdBy.name} ELIMINADO. Snapshot disponible.`, t);
      await db.remove(id);

      const delMail = {
        to: ADMIN_RECIPIENTS,
        subject: `El ${t.id} ha sido eliminado correctamente`,
        html: renderEmail(t, `Ticket eliminado del sistema`, `SEGURIDAD TI`, `BORRADO`, '#e11d48',
          `<p>El Ticket <strong>#${t.id}</strong> con título "<strong>${t.title}</strong>" ha sido eliminado por un administrador.</p>`),
        attachments: EMAIL_ATTACHMENTS
      };
      sendMailResilient(delMail).catch(e => console.error('[DEL-MAIL-ERR]', e));
      await createNotification(`Ticket Eliminado: ${t.id}`, `El ticket de ${t.createdBy.name} ha sido borrado por administración.`, t.id, 'admin', 'warning');
    }
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.get('/backup/list', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).map(f => {
      const stats = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, createdAt: stats.mtime, sizeBytes: stats.size };
    }).sort((a, b) => b.createdAt - a.createdAt);
    res.json(files);
  } catch (e) { res.status(500).json([]); }
});

app.get('/admin/users', async (req, res) => {
  try { res.json(await Users.getAll()); } catch (e) { res.status(500).json([]); }
});

app.get('/admin/emails', (req, res) => {
  res.json(Users.getAdminEmails());
});

app.post('/admin/emails', async (req, res) => {
  try {
    const { email } = req.body;
    const actor = req.headers['iceberg-user'] || 'Desconocido';
    if (!email) return res.status(400).send();
    await Users.addAdminEmail(email);
    await db.addAuditLog(actor, 'AGREGAR_ADMIN', email, 'Nuevo administrador autorizado');
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.delete('/admin/emails', async (req, res) => {
  try {
    const { email } = req.body;
    const actor = req.headers['iceberg-user'] || 'Desconocido';
    await Users.removeAdminEmail(email);
    await db.addAuditLog(actor, 'QUITAR_ADMIN', email, 'Acceso revocado');
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.put('/admin/users/toggle/:id', async (req, res) => {
  try {
    const actor = req.headers['iceberg-user'] || 'Desconocido';
    const result = await Users.update(req.params.id, {});
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    result.active = !result.active;
    await Users.update(req.params.id, { active: result.active });
    await db.addAuditLog(actor, 'TOGGLE_USUARIO', result.email || req.params.id, `Estado cambiado a: ${result.active ? 'Activo' : 'Inactivo'}`);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.delete('/admin/users/:id', async (req, res) => {
  try {
    const actor = req.headers['iceberg-user'] || 'Desconocido';
    const u = await Users.getByEmail(req.params.id) || await Users.update(req.params.id, { active: false });
    if (u) await db.addAuditLog(actor, 'DESACTIVAR_USUARIO', u.email || req.params.id, 'Usuario desactivado');
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.get('/admin/audit-logs', async (req, res) => {
  try {
    const logs = await db.getAuditLogs(400);
    res.json(logs);
  } catch (e) { res.status(500).json([]); }
});

app.post('/backup/create', async (req, res) => {
  try {
    const data = await db.getAll();
    const fname = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(BACKUP_DIR, fname), JSON.stringify(data, null, 2));
    res.json({ success: true, filename: fname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/backup/restore', async (req, res) => {
  try {
    const { filename } = req.body;
    const fpath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'No existe' });
    const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    await db.removeAll();
    for (const t of data) { await db.create(t); }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/backup/download/:file', (req, res) => {
  const fpath = path.join(BACKUP_DIR, req.params.file);
  if (fs.existsSync(fpath)) res.download(fpath);
  else res.status(404).send();
});

app.get('/backup/export/csv', async (req, res) => {
  try {
    const tickets = await db.getAll();
    let csv = 'ID;Fecha;Titulo;Usuario;Area;Estado;Prioridad\n';
    tickets.forEach(t => {
      const u = t.createdBy.name === 'Usuario Corporativo' ? t.createdBy.email.split('@')[0] : t.createdBy.name;
      csv += `${t.id};${t.createdAt};"${t.title}";"${u}";"${t.area}";${t.status};${t.priority}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tickets_export.csv');
    res.send(csv);
  } catch (e) { res.status(500).send(); }
});

app.post('/auth/login-email', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).send();
    if (Users.isMasterAdmin(email)) return res.status(403).json({ isAdmin: true });
    if (Users.isCorporate(email)) {
      let u = await Users.getByEmail(email);
      if (!u) u = await Users.create({ email });
      return res.json({ token: Buffer.from(email).toString('base64'), user: u, requiresNameVerification: !!u.requiresNameVerification });
    }
    res.status(404).json({ error: 'No corporativo autorizado.' });
  } catch (e) { res.status(500).send(); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const emailLow = (email || '').toLowerCase().trim();
    let u = await Users.getByEmail(emailLow);
    if (!u) return res.status(404).send();
    if (name) {
      await Users.update(u.id, { name, requiresNameVerification: 0 });
      u = await Users.getByEmail(emailLow);
      return res.json({ user: u, success: true });
    }
    if (Users.isMasterAdmin(emailLow) && password) {
      const seeds = Users.getAdminSeeds ? Users.getAdminSeeds() : [];
      const seed = seeds.find(s => s.email.toLowerCase() === emailLow);
      const valid = u.password || (seed ? seed.password : null);
      if (valid && password !== valid) return res.status(401).send();
    }
    if (u.requiresNameVerification) return res.json({ requiresNameVerification: true });
    res.json({ token: Buffer.from(emailLow).toString('base64'), user: u, success: true });
  } catch (e) { res.status(500).send(); }
});

app.post('/auth/sync-microsoft', async (req, res) => {
  try {
    const { email, name } = req.body;
    const emailLow = (email || '').toLowerCase().trim();
    if (!emailLow) return res.status(400).send();
    if (!Users.getAdminEmails().includes(emailLow)) {
      return res.status(403).json({ error: 'Acceso restringido. Solo administradores autorizados.' });
    }
    let u = await Users.getByEmail(emailLow);
    if (!u) u = await Users.create({ email: emailLow, name: name || emailLow.split('@')[0], role: 'admin' });
    res.json({ token: Buffer.from(emailLow).toString('base64'), user: u });
  } catch (e) { res.status(500).send(); }
});

app.get('/notifications', async (req, res) => {
  try {
    const userEmail = (req.headers['iceberg-user'] || '').toLowerCase().trim();

    if (!userEmail) return res.json([]);
    const isAdmin = Users.isMasterAdmin(userEmail) || Users.getAdminEmails().includes(userEmail);

    const all = await db.getNotifications(50);

    const filtered = all.filter(n => {
      if (n.userId === 'all') return true;
      if (n.userId === 'admin' && isAdmin) return true;
      if (n.userId === userEmail) return true;
      return false;
    });

    res.json(filtered);
  } catch (e) { res.status(500).json([]); }
});

app.post('/notifications/:id/read', async (req, res) => {
  try {
    await db.markNotificationRead(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.post('/notifications/read-all', async (req, res) => {
  try {
    const userEmail = (req.headers['iceberg-user'] || '').toLowerCase().trim();
    const isAdmin = Users.isMasterAdmin(userEmail) || Users.getAdminEmails().includes(userEmail);
    await db.markAllNotificationsRead(userEmail, isAdmin);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

async function createNotification(title, message, ticketId, userId = 'all', type = 'info') {
  try {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.createNotification({ id, userId, ticketId, title, message, type });
  } catch (e) { console.error('[NOTIF ERR]', e.message); }
}

app.get('/debug/state', async (req, res) => {
  try {
    const list = await db.getAll();
    res.json({
      ticketsCount: list.length,
      serverTime: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || 'development',
      port: PORT,
      adminCount: Users.getAdminEmails().length
    });
  } catch (e) { res.json({ error: e.message }); }
});

app.get('*', (req, res) => {
  if (req.path.includes('/')) res.sendFile(path.join(__dirname, '..', 'index.html'));
  else res.status(404).send();
});

app.post('/admin/test-email', async (req, res) => {
  try {
    const actor = req.headers['iceberg-user'] || 'Prueba de Sistema';
    console.log(`[TEST-MAIL] Solicitado por: ${actor}`);
    const testMail = {
      to: [process.env.EMAIL_USER],
      subject: `🧪 Test de Notificación: IT Portal`,
      html: `
        <div style="font-family:sans-serif; border: 1px solid #e2e8f0; border-radius:12px; padding:24px; color:#1e293b;">
          <h2 style="color:#2563eb; margin-top:0;">Prueba de Conexión Lograda</h2>
          <p>Este es un correo de prueba generado para verificar la configuración de los motores de envío.</p>
          <ul style="color:#475569; font-size:14px;">
            <li><strong>Tiempo:</strong> ${new Date().toLocaleString()}</li>
            <li><strong>Usuario:</strong> ${actor}</li>
            <li><strong>Motor MS Graph:</strong> ${process.env.AZURE_CLIENT_SECRET ? 'CONFIGURADO' : 'NO CONFIGURADO'}</li>
            <li><strong>Motor SendGrid:</strong> ${process.env.SENDGRID_API_KEY ? 'CONFIGURADO' : 'NO CONFIGURADO'}</li>
          </ul>
        </div>
      `
    };
    const result = await sendMailResilient(testMail);
    res.json({ success: !!result, details: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT_VAL = PORT;
app.listen(PORT_VAL, () => {
  console.log(`
  🚀 SERVIDOR CONTROL TI ONLINE
  ==============================
  📡 Puerto: ${PORT_VAL}
  📧 Email:  ${process.env.EMAIL_USER || 'No configurado'}
  📂 Data:   ${path.join(__dirname, 'data')}
  ==============================
  `);
  Users.initialize().catch(() => { });

  setTimeout(() => {
    transporter.verify((err) => {
      if (err) console.error('[OUTLOOK STATUS] Offline (Port 587 Blocked?)');
      else console.log('[OUTLOOK STATUS] Connected.');
    });
  }, 1000);
});

process.on('uncaughtException', (err) => console.error('[FATAL]', err.message));
process.on('unhandledRejection', (reason) => console.error('[REJECTION]', reason));
module.exports = app;
