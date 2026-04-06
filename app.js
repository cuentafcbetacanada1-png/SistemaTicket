'use strict';

const AZURE_CONFIG = {
  clientId: '9850a376-3cb2-43e0-86be-eb7d450ed0cd',
  tenantId: '9d1e7ff3-830f-4cf1-b923-44aa90a380d0',
  get redirectUri() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      const port = window.location.port;
      if (port === '5500') return 'http://localhost:5500/tickets/index.html';
      return 'http://localhost:3000';
    }
    return 'https://sistema-tickets.up.railway.app';
  },
};

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AZURE_CONFIGURED =
  GUID_RE.test(AZURE_CONFIG.clientId) &&
  GUID_RE.test(AZURE_CONFIG.tenantId);

let msalApp = null;

const MSAL_SCOPES = { scopes: ['openid', 'profile', 'email', 'User.Read'] };

const IT_STAFF = ['Gustavo Velandia', 'Edgar Ducuara', 'Stiven Arevalo', 'Juan Ducuara'];

const ADMINS_LIST = [
  { name: 'Gustavo Velandia', email: 'gustavo.velandia@iceberg.com.co', role: 'Director de Sistemas' },
  { name: 'Edgar Ducuara', email: 'soporteti@iceberg.com.co', role: 'Ingeniero de Desarrollo' },
  { name: 'Stiven Arevalo', email: 'soporte2@iceberg.com.co', role: 'Ingeniero de Soporte' },
  { name: 'Juan Ducuara', email: 'aprendiz.sistemas@iceberg.com.co', secondaryEmail: 'asistente.sistemas@iceberg.com.co', role: 'Asistente de soporte' },
];

const CAT_LABELS = {
  'cambio-equipo': 'Cambio de equipo',
  'reparacion-arreglo': 'Reparación / Arreglo',
  'falla-software': 'Falla en programa',
  'instalacion-equipo': 'Instalación de equipo',
  'instalacion-software': 'Instalación de software',
  'acceso-permisos': 'Acceso / Permisos',
  'red-conectividad': 'Red / Conectividad',
  'otro': 'Otro',
};

const CAT_COLORS = {
  'cambio-equipo': '#2563eb',
  'reparacion-arreglo': '#4f46e5',
  'falla-software': '#9f1239',
  'instalacion-equipo': '#0d9488',
  'instalacion-software': '#0369a1',
  'acceso-permisos': '#0e7490',
  'red-conectividad': '#7c3aed',
  'otro': '#475569',
};

const STATUS_LABELS = { 'abierto': 'Abierto', 'en-progreso': 'En progreso', 'resuelto': 'Resuelto', 'cerrado': 'Cerrado' };
const PRIORITY_LABELS = { 'baja': 'Baja', 'media': 'Media', 'alta': 'Alta', 'critica': 'Crítica' };

const Store = {
  getLocalTickets() {
    try { return JSON.parse(localStorage.getItem('ice_tickets') || 'null') || []; }
    catch (e) { return []; }
  },
  saveLocal(t) { localStorage.setItem('ice_tickets', JSON.stringify(t)); },
  getSession() { try { return JSON.parse(localStorage.getItem('ice_session')); } catch (e) { return null; } },
  saveSession(u) { localStorage.setItem('ice_session', JSON.stringify(u)); },
  clearSession() { localStorage.removeItem('ice_session'); },
  getTickets() { return this.getLocalTickets(); },
  saveTickets(t) { this.saveLocal(t); },
  getLocalNotifications() {
    try { return JSON.parse(localStorage.getItem('ice_local_notifications') || '[]'); }
    catch (e) { return []; }
  },
  saveLocalNotifications(n) { localStorage.setItem('ice_local_notifications', JSON.stringify(n)); }
};

const IS_LOCAL_FILE = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PROD_URL = 'https://sistema-tickets.up.railway.app';
let API_URL_VAR = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://localhost:3000';
let API_URL = window.location.origin;
try {
  const override = localStorage.getItem('ice_api_override');
  if (override) API_URL = override;
  else if (IS_LOCAL_FILE) API_URL = 'http://localhost:3000';
} catch (e) { }

if (typeof API_URL === 'string' && API_URL.endsWith('/')) API_URL = API_URL.slice(0, -1);
console.log(`%c[ICEBERG] API Endpoint: %c${API_URL}`, "font-weight:bold; color:#7c3aed;", "font-weight:bold; color:#2563eb;");
if (window.location.hostname === 'localhost') {
  console.warn("⚠️ ESTÁS EN LOCALHOST. Si quieres probar Railway, usa la URL de producción.");
}

const API = {
  _up: null,

  async _fetch(path, opts = {}) {
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const url = API_URL + cleanPath;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        'iceberg-user': (Store.getSession()?.email || 'Desconocido')
      };

      const r = await fetch(url, { ...opts, headers, signal: ctrl.signal });
      clearTimeout(timer);
      this._up = r.ok || (r.status < 500 && r.status !== 503);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (err) {
      clearTimeout(timer);
      this._up = false;
      throw err;
    }
  },


  async checkHealth() {
    try {
      const r = await this._fetch('/health');
      const d = await r.json();
      this._up = true;
      this._dbConnected = true;
      this._dbMode = d.dbMode || 'local';
      return d;
    } catch {
      this._up = false;
      this._dbConnected = false;
      return null;
    }
  },

  async getTickets() {
    try {
      const r = await this._fetch('/tickets');
      if (r.ok) {
        const d = await r.json();
        const tickets = d || [];
        if (tickets.length > 0) {
          Store.saveLocal(tickets);
        }
        return tickets.length > 0 ? tickets : Store.getLocalTickets();
      }
      return Store.getLocalTickets();
    } catch {
      return Store.getLocalTickets();
    }
  },

  async createTicket(ticket) {
    const local = Store.getLocalTickets();
    Store.saveLocal([ticket, ...local]);
    try {
      const r = await this._fetch('/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticket),
      });
      return await r.json();
    } catch {
      return ticket;
    }
  },

  async updateTicket(id, patch) {
    const local = Store.getLocalTickets();
    const idx = local.findIndex(t => t.id === id);
    if (idx >= 0) { local[idx] = { ...local[idx], ...patch, updatedAt: new Date().toISOString() }; Store.saveLocal(local); }
    try {
      const r = await this._fetch(`/tickets/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return await r.json();
    } catch {
      return local[idx] || null;
    }
  },

  async deleteTicket(id, user = null) {
    const local = Store.getLocalTickets().filter(t => t.id !== id);
    Store.saveLocal(local);
    try {
      let url = `/tickets/${encodeURIComponent(id)}`;
      if (user) url += `?user=${encodeURIComponent(JSON.stringify({ id: user.id, name: user.name, email: user.email }))}`;
      await this._fetch(url, { method: 'DELETE' });
      return true;
    } catch {
      return true;
    }
  },

  async createBackup() {
    const r = await this._fetch('/backup/create', { method: 'POST' });
    return r.json();
  },

  async listBackups() {
    const r = await this._fetch('/backup/list');
    return r.json();
  },

  async restoreBackup(filename) {
    const r = await this._fetch('/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    return r.json();
  },

  downloadBackup(filename) { window.open(`${API_URL}/backup/download/${encodeURIComponent(filename)}`); },
  exportCSV() { window.open(`${API_URL}/backup/export/csv`); },
  exportJSON() { window.open(`${API_URL}/backup/export/json`); },

  serverLabel() {
    if (this._up === null) return { text: 'Verificando…', cls: 'server-unknown' };
    if (this._up === true) {
      return { text: '● Servidor corporativo OK', cls: 'server-online' };
    }
    return { text: '● Modo offline (localStorage)', cls: 'server-offline' };
  },

  async getAuditLogs() {
    const r = await this._fetch('/admin/audit-logs');
    return r.json();
  },
};


const APP = {
  user: null,
  tickets: [],
  sidebarActive: true,
  _lastNotifId: null,
  notifPoller: null,
  openTicketId: null,
  selectedCategory: '',
  pendingTicketId: null,
  _charts: {},


  async init() {
    const isSoundOn = localStorage.getItem('ice_sound') !== 'false';
    const soundToggle = document.getElementById('toggle-sound');
    if (soundToggle) soundToggle.checked = isSoundOn;

    if (localStorage.getItem('ice_darkmode') === 'true') {
      document.body.classList.add('theme-dark');
      document.documentElement.classList.add('theme-dark');
    }

    if (this._initialized) {
      await this.refreshData();
      return;
    }

    const health = await API.checkHealth();
    this.tickets = await API.getTickets();

    this._updateServerBadge();

    ['support-nav-section', 'view-knowledge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    const obsoleteFields = ['t-asset', 't-software'];
    obsoleteFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const wrapper = el.closest('.fg');
        if (wrapper) wrapper.style.display = 'none';
      }
    });

    if (!this._syncInterval) {
      this._syncInterval = setInterval(async () => {
        if (this.user && document.visibilityState === 'visible') {
          const wasUp = API._up !== false;
          if (API._up === false || API._dbConnected === false) await API.checkHealth();

          const isUp = API._up !== false;

          if (!isUp && wasUp && !this._serverDownNotified) {
            this._serverDownNotified = true;
            this.addLocalNotification({
              id: 'sys-down',
              title: 'Servidor Desconectado',
              message: 'La conexión con el servidor se ha perdido. Trabajando en modo local.',
              type: 'warning',
              timestamp: new Date().toISOString()
            });
          } else if (isUp && !wasUp) {
            this._serverDownNotified = false;
            this.addLocalNotification({
              id: 'sys-up',
              title: 'Conexión Recuperada',
              message: 'El servidor está online nuevamente. Sincronizando datos...',
              type: 'info',
              timestamp: new Date().toISOString()
            });
          }

          if (isUp && API._dbConnected !== false) {
            await this.syncOfflineTickets();
            this.tickets = await API.getTickets();
            this.updateMyCounts();
            if (this.currentView === 'dashboard' || this.currentView === 'admin-tickets' || this.currentView === 'my-tickets') {
              this.renderView(this.currentView);
            }
            this._updateServerBadge();
          } else {
            this._updateServerBadge();
          }
        }
      }, 12000);
    }

    this.bindLogin();
    this.bindSidebar();
    this.bindModal();

    const msClose = document.getElementById('ms-restricted-close');
    if (msClose) msClose.onclick = () => { document.getElementById('ms-restricted-modal').style.display = 'none'; };

    const btn = document.getElementById('btn-add-admin');
    if (btn) btn.onclick = () => this._addAdminEmail();

    if (AZURE_CONFIGURED && typeof msal !== 'undefined') {
      try {
        msalApp = new msal.PublicClientApplication({
          auth: {
            clientId: AZURE_CONFIG.clientId,
            authority: `https://login.microsoftonline.com/${AZURE_CONFIG.tenantId}`,
            redirectUri: AZURE_CONFIG.redirectUri,
          },
          cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true },
        });
        msalApp.handleRedirectPromise()
          .then(resp => { if (resp) this._onMsalSuccess(resp); })
          .catch(err => console.warn('MSAL redirect:', err));
        const accounts = msalApp.getAllAccounts();
        if (accounts.length > 0) {
          msalApp.acquireTokenSilent({ ...MSAL_SCOPES, account: accounts[0] })
            .then(resp => this._onMsalSuccess(resp))
            .catch(() => { });
        }
      } catch (err) {
        console.error('MSAL init error:', err);
      }
    }

    const saved = Store.getSession();
    if (saved && !this.user) {
      this.user = saved;
      this.startApp();
    } else if (!this.user) {
      document.getElementById('screen-login').style.display = 'flex';
    }

    this.bindGlobalSearch();

    this._initialized = true;

    const urlParams = new URLSearchParams(window.location.search);
    let tid = urlParams.get('ticket') || urlParams.get('ticketId');
    const hash = window.location.hash;
    if (tid && hash && !tid.includes('#')) {
      tid = tid.trim() + ' ' + hash;
    }
    this.pendingTicketId = tid;
    if (this.pendingTicketId && this.user) this._checkPendingTicket();
  },

  async refreshData() {
    this.tickets = await API.getTickets();
    this.updateMyCounts();
    this.renderView(this.currentView);
    this._updateServerBadge();
  },

  _checkPendingTicket() {
    if (!this.pendingTicketId) return;
    const tid = this.pendingTicketId;
    this.pendingTicketId = null;
    setTimeout(() => {
      this.openModal(tid);
      const url = new URL(window.location);
      url.searchParams.delete('ticket');
      window.history.replaceState({}, document.title, url.pathname);
    }, 600);
  },

  _updateServerBadge() {
    const badge = document.getElementById('server-status-badge');
    if (!badge) return;
    if (this.user?.role !== 'admin') {
      badge.style.display = 'none';
      if (document.getElementById('admin-badge-top')) document.getElementById('admin-badge-top').style.display = 'none';
      return;
    }
    badge.style.display = 'inline-block';
    if (document.getElementById('admin-badge-top')) document.getElementById('admin-badge-top').style.display = 'flex';
    const s = API.serverLabel();
    badge.textContent = s.text;
    badge.className = `server-badge ${s.cls}`;
    if (s.style) badge.style.cssText = s.style; else badge.style.cssText = '';
  },

  async loginWithMicrosoft() {
    if (!AZURE_CONFIGURED) {
      this.showToast('⚠️ Azure AD no configurado.', 'error');
      return;
    }
    if (!msalApp) {
      this.showToast('❌ MSAL no inicializado.', 'error');
      return;
    }
    const btn = document.getElementById('btn-ms-login');
    const txt = document.getElementById('ms-btn-txt');
    const spin = document.getElementById('ms-spinner');

    if (this._msalPending) return;
    this._msalPending = true;

    btn.disabled = true;
    txt.style.display = 'none';
    spin.style.display = 'block';
    try {
      sessionStorage.clear();
      const resp = await msalApp.loginPopup(MSAL_SCOPES);
      await this._onMsalSuccess(resp);
    } catch (err) {
      console.error('MSAL login error:', err);
      if (err.errorCode === 'interaction_in_progress') {
        this.showToast('⚠️ Microsoft ya está procesando una entrada. Refresca la página.', 'warning');
      } else if (err.errorCode !== 'user_cancelled') {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    } finally {
      this._msalPending = false;
      btn.disabled = false;
      txt.style.display = 'inline';
      spin.style.display = 'none';
    }
  },

  async _onMsalSuccess(resp) {
    if (!resp || !resp.account) return;
    try {
      const graphResp = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${resp.accessToken}` },
      });
      const profile = await graphResp.json();
      const email = (profile.mail || profile.userPrincipalName || '').toLowerCase();
      const name = profile.displayName || resp.account.name || email.split('@')[0];

      const adminEmailsFetch = await API._fetch('/admin/emails').then(r => r.json()).catch(() => []);
      const adminEmails = Array.isArray(adminEmailsFetch) ? adminEmailsFetch : [];
      const isAdminEmail = adminEmails.some(ae => ae.toLowerCase() === email);

      if (!isAdminEmail) {
        const modal = document.getElementById('ms-restricted-modal');
        if (modal) {
          modal.style.display = 'flex';
          setTimeout(() => modal.classList.add('active'), 10);
        }
        return;
      }

      const syncResp = await API._fetch('/auth/sync-microsoft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          role: 'admin',
          id: resp.account.localAccountId || resp.account.homeAccountId
        })
      });

      if (!syncResp.ok) {
        const errData = await syncResp.json().catch(() => ({}));
        throw new Error(errData.error || 'Error de sincronización con el servidor.');
      }
      const syncData = await syncResp.json();

      this._finishLogin({ ...syncData.user, source: 'microsoft' });
      return;
    } catch (err) {
      console.error('[MS LOGIN ERROR]', err);
      this.showToast(`❌ Error: ${err.message}`, 'error');
    }
  },

  bindLogin() {
    const notice = document.getElementById('azure-notice');
    if (notice && !AZURE_CONFIGURED) notice.style.display = 'flex';

    const btnMs = document.getElementById('btn-ms-login');
    if (btnMs) {
      btnMs.addEventListener('click', () => {
        this.loginWithMicrosoft();
      });
    }

    const pwToggle = document.getElementById('pw-toggle');
    const passInput = document.getElementById('l-pass');
    const eyeOn = document.getElementById('eye-on');
    const eyeOff = document.getElementById('eye-off');

    if (pwToggle && passInput && eyeOn && eyeOff) {
      pwToggle.addEventListener('click', () => {
        const isText = passInput.type === 'text';
        passInput.type = isText ? 'password' : 'text';
        eyeOn.style.display = isText ? 'block' : 'none';
        eyeOff.style.display = isText ? 'none' : 'block';
      });
    }

    this._loginStep = 'email';

    document.getElementById('form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('l-email').value.trim().toLowerCase();
      const pass = document.getElementById('l-pass').value;

      if (this._loginStep === 'email') {
        if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          document.getElementById('err-lemail').textContent = 'Ingresa un correo corporativo válido.';
          document.getElementById('err-lemail').classList.add('show');
          return;
        }
        document.getElementById('err-lemail').classList.remove('show');

        const btn = document.getElementById('login-btn');
        document.getElementById('login-txt').style.display = 'none';
        document.getElementById('login-spinner').style.display = 'block';
        btn.disabled = true;

        try {
          const r = await API._fetch('/auth/login-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          btn.disabled = false;
          document.getElementById('login-txt').style.display = 'inline';
          document.getElementById('login-spinner').style.display = 'none';

          if (r.ok) {
            const data = await r.json();
            this._finishLogin({ ...data.user, source: 'db' });
            return;
          }

          const errData = await r.json();

          if (r.status === 403 && errData.isAdmin) {
            this._loginStep = 'password';
            document.getElementById('pass-field').style.display = 'block';
            const admNotice = document.getElementById('admin-detected-notice');
            if (admNotice) admNotice.style.display = 'flex';
            document.getElementById('remember-row').style.display = 'flex';
            document.getElementById('l-email').setAttribute('readonly', 'true');
            document.getElementById('l-email').style.opacity = '0.5';
            document.getElementById('login-btn').textContent = 'Entrar';
            document.getElementById('l-pass').focus();
          } else if (r.status === 404) {
            document.getElementById('err-lemail').textContent = 'Correo no encontrado. Verifica que esté registrado.';
            document.getElementById('err-lemail').classList.add('show');
          } else {
            document.getElementById('err-lemail').textContent = errData.error || 'Error al verificar el correo.';
            document.getElementById('err-lemail').classList.add('show');
          }
        } catch {
          btn.disabled = false;
          document.getElementById('login-txt').style.display = 'inline';
          document.getElementById('login-spinner').style.display = 'none';
          this._loginStep = 'password';
          document.getElementById('pass-field').style.display = 'block';
          document.getElementById('remember-row').style.display = 'flex';
          document.getElementById('l-pass').focus();
        }
        return;
      }

      if (!pass) {
        document.getElementById('err-lpass').classList.add('show');
        return;
      }
      document.getElementById('err-lpass').classList.remove('show');

      const btn = document.getElementById('login-btn');
      document.getElementById('login-txt').style.display = 'none';
      document.getElementById('login-spinner').style.display = 'block';
      btn.disabled = true;

      try {
        const r = await API._fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass }),
        });

        btn.disabled = false;
        document.getElementById('login-txt').style.display = 'inline';
        document.getElementById('login-spinner').style.display = 'none';

        if (r.ok) {
          const data = await r.json();
          if (data.requiresNameVerification) {
            this._pendingCreds = { email, pass };
            document.getElementById('login-methods-stage').style.display = 'none';
            document.getElementById('name-verify-step').style.display = 'block';
            document.getElementById('nv-name').value = '';
            document.getElementById('err-nv-name').classList.remove('show');
            document.getElementById('nv-name').focus();
            return;
          }
          this._finishLogin({ ...data.user, source: 'db' });
        } else {
          const err = await r.json();
          document.getElementById('err-lpass').textContent = err.error || 'Contraseña incorrecta.';
          document.getElementById('err-lpass').classList.add('show');
        }
      } catch {
        btn.disabled = false;
        document.getElementById('login-txt').style.display = 'inline';
        document.getElementById('login-spinner').style.display = 'none';
        document.getElementById('err-lpass').textContent = 'Error de conexión. Intenta de nuevo.';
        document.getElementById('err-lpass').classList.add('show');
      }
    });

    document.getElementById('btn-back-email').addEventListener('click', () => {
      this._loginStep = 'email';
      document.getElementById('pass-field').style.display = 'none';
      document.getElementById('admin-detected-notice').style.display = 'none';
      document.getElementById('remember-row').style.display = 'none';
      document.getElementById('l-email').removeAttribute('readonly');
      document.getElementById('l-email').style.opacity = '1';
      document.getElementById('l-pass').value = '';
      document.getElementById('login-btn').textContent = 'Continuar';
      document.getElementById('err-lemail').classList.remove('show');
      document.getElementById('err-lpass').classList.remove('show');
      document.getElementById('l-email').focus();
    });

    document.getElementById('btn-nv-verify').addEventListener('click', async () => {
      const name = document.getElementById('nv-name').value.trim();
      document.getElementById('err-nv-name').classList.remove('show');
      if (!name) {
        document.getElementById('err-nv-name').textContent = 'Ingresa tu nombre completo.';
        document.getElementById('err-nv-name').classList.add('show');
        return;
      }
      const nvBtn = document.getElementById('btn-nv-verify');
      document.getElementById('nv-btn-txt').style.display = 'none';
      document.getElementById('nv-spinner').style.display = 'block';
      nvBtn.disabled = true;

      const { email, pass } = this._pendingCreds || {};
      try {
        const r = await API._fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass, name }),
        });
        if (r.ok) {
          const data = await r.json();
          this._pendingCreds = null;
          this._finishLogin({ ...data.user, source: 'db' });
        } else {
          const err = await r.json();
          document.getElementById('err-nv-name').textContent = err.error || 'Nombre incorrecto. Acceso denegado.';
          document.getElementById('err-nv-name').classList.add('show');
          document.getElementById('nv-name').value = '';
          document.getElementById('nv-name').focus();
        }
      } catch {
        document.getElementById('err-nv-name').textContent = 'Error de conexión. Intenta de nuevo.';
        document.getElementById('err-nv-name').classList.add('show');
      }
      nvBtn.disabled = false;
      document.getElementById('nv-btn-txt').style.display = 'inline';
      document.getElementById('nv-spinner').style.display = 'none';
    });

    document.getElementById('nv-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-nv-verify').click();
    });

    const msRestrictedClose = document.getElementById('ms-restricted-close');
    if (msRestrictedClose) {
      msRestrictedClose.addEventListener('click', () => {
        const modal = document.getElementById('ms-restricted-modal');
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
      });
    }

    document.getElementById('btn-nv-back').addEventListener('click', () => {
      this._pendingCreds = null;
      document.getElementById('name-verify-step').style.display = 'none';
      document.getElementById('login-methods-stage').style.display = 'block';
      document.getElementById('err-nv-name').classList.remove('show');
    });
  },

  _finishLogin(user) {
    this.user = user;
    Store.saveSession(this.user);
    this._updateServerBadge();
    this.startApp();
  },

  startApp() {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-app').style.display = 'flex';

    const nameEls = document.querySelectorAll('#u-name-top');
    let displayName = this.user.name;
    if (!displayName || displayName === 'Usuario Corporativo' || displayName === 'Usuario Microsoft') {
      displayName = this.user.email.split('@')[0];
    }
    nameEls.forEach(el => el.textContent = displayName);

    const roleEls = document.querySelectorAll('#u-role-top');
    const roleText = this.user.role === 'admin' ? '🛡 Administrador IT' : (this.user.role === 'staff' ? '🛠 Soporte IT' : '👤 Empleado');
    roleEls.forEach(el => el.textContent = roleText);

    if (this.user.role === 'admin') {
      document.getElementById('admin-nav').style.display = 'block';
    } else {
      document.getElementById('admin-nav').style.display = 'none';
    }

    const eName = document.getElementById('ud-name-full');
    const eEmail = document.getElementById('ud-email-full');
    if (eName) eName.textContent = this.user.name;
    if (eEmail) eEmail.textContent = this.user.email;

    this.setupProfileDropdown();

    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const greetEl = document.getElementById('greeting');
    if (greetEl) greetEl.textContent = `${greet}, ${this.user.name.split(' ')[0]}. Bienvenido al sistema de soporte.`;
    const agEl = document.getElementById('admin-greeting');
    if (agEl) agEl.textContent = `${greet}, ${this.user.name.split(' ')[0]}. Panel de control administrativo IT de Iceberg.`;

    this.nav(this.user.role === 'admin' ? 'admin-dashboard' : 'dashboard');
    this.updateMyCounts();
    this.bindNotifications();
    this.fetchNotifications();
    this._checkPendingTicket();
  },

  setupProfileDropdown() {
    const trigger = document.getElementById('tb-dropdown-trigger');
    const panel = document.getElementById('u-dropdown');
    if (!trigger || !panel) return;

    trigger.onclick = (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    };

    document.addEventListener('click', () => panel.classList.remove('open'));
    panel.onclick = (e) => e.stopPropagation();
  },

  showSettings() {
    const modal = document.getElementById('modal-settings');
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => modal.style.opacity = '1', 10);
      document.getElementById('toggle-darkmode').checked = localStorage.getItem('ice_darkmode') === 'true';
    }
  },

  closeSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(() => modal.style.display = 'none', 300);
    }
  },

  toggleDarkMode(isDark) {
    if (isDark) {
      document.body.classList.add('theme-dark');
      document.documentElement.classList.add('theme-dark');
      localStorage.setItem('ice_darkmode', 'true');
    } else {
      document.body.classList.remove('theme-dark');
      document.documentElement.classList.remove('theme-dark');
      localStorage.setItem('ice_darkmode', 'false');
    }
  },

  toggleSound(isSound) {
    if (isSound) localStorage.setItem('ice_sound', 'true');
    else localStorage.setItem('ice_sound', 'false');
  },

  bindSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sb-overlay');

    const open = () => { if (sb) sb.classList.add('open'); if (ov) ov.classList.add('show'); };
    const close = () => { if (sb) sb.classList.remove('open'); if (ov) ov.classList.remove('show'); };

    const btnOpen = document.getElementById('sb-open');
    if (btnOpen) btnOpen.addEventListener('click', open);

    const btnClose = document.getElementById('sb-close');
    if (btnClose) btnClose.addEventListener('click', close);

    if (ov) ov.addEventListener('click', close);
    document.getElementById('btn-logout-new').addEventListener('click', () => this.logout());

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.nav(btn.dataset.view);
        close();
      });
    });
  },

  logout() {
    if (this.user?.source === 'microsoft' && msalApp) {
      const account = msalApp.getAllAccounts()[0];
      if (account) {
        msalApp.logoutPopup({ account, mainWindowRedirectUri: window.location.href })
          .catch(() => { });
      }
    }
    Store.clearSession();
    this.user = null;
    document.getElementById('screen-app').style.display = 'none';
    document.getElementById('screen-login').style.display = 'flex';
    document.getElementById('form-login').reset();

    this._loginStep = 'email';
    const emailField = document.getElementById('l-email');
    const passField = document.getElementById('pass-field');
    const loginMethods = document.getElementById('login-methods-stage');
    const nameVerify = document.getElementById('name-verify-step');

    if (passField) passField.style.display = 'none';
    if (loginMethods) loginMethods.style.display = 'block';
    if (nameVerify) nameVerify.style.display = 'none';
    if (emailField) {
      emailField.value = '';
      emailField.disabled = false;
    }

    const btn = document.getElementById('login-btn');
    if (btn) {
      btn.disabled = false;
      const txt = document.getElementById('login-txt');
      const spin = document.getElementById('login-spinner');
      if (txt) txt.style.display = 'block';
      if (spin) spin.style.display = 'none';
    }

    document.getElementById('admin-nav').style.display = 'none';
    if (document.getElementById('sidebar')) document.getElementById('sidebar').classList.remove('open');
    this.showToast('Sesión cerrada exitosamente.', 'info');
  },

  nav(view) {
    this.currentView = view;
    document.querySelectorAll('.view-pane').forEach(v => v.style.display = 'none');
    const el = document.getElementById(`view-${view}`);
    if (el) el.style.display = 'flex';
    document.querySelectorAll('.nav-item[data-view]').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    this.renderView(view);
    window.scrollTo(0, 0);
  },

  async copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => btn.innerHTML = original, 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  },

  renderView(view) {
    switch (view) {
      case 'dashboard': this.renderDashboard(); break;
      case 'new-ticket': this.resetTicketForm(); break;
      case 'my-tickets': this.renderMyTickets(); break;
      case 'admin-dashboard': this.renderAdminDashboard(); break;
      case 'admin-tickets': this.renderAdminTickets(); break;
      case 'admin-users': this.renderAdminUsers(); break;
      case 'admin-audit': this.renderAuditLogs(); break;
      case 'admin-backup': this.renderAdminBackup(); break;
    }
  },

  updateMyCounts() {
    const tlist = this.tickets || [];
    const uid = this.user?.id;
    const umail = this.user?.email?.toLowerCase();

    const mine = tlist.filter(t => {
      if (!t.createdBy || !this.user) return false;
      if (t.status === 'cerrado') return false;
      const t_uid = t.createdBy.id;
      const t_umail = (t.createdBy.email || t.createdBy.username || '').toLowerCase();
      return (t_uid === uid) || (t_umail && umail && (t_umail === umail || umail.includes(t_umail) || t_umail.includes(umail)));
    }).length;

    const el = document.getElementById('my-cnt');
    if (el) { el.textContent = mine; el.style.display = mine > 0 ? 'inline' : 'none'; }

    const open = tlist.filter(t => t.status === 'abierto').length;
    const ael = document.getElementById('admin-open-cnt');
    if (ael) { ael.textContent = open; ael.style.display = open > 0 ? 'inline' : 'none'; }
  },

  renderDashboard() {
    const q = (document.getElementById('global-search')?.value || '').toLowerCase().trim();
    const tlist = this.tickets || [];
    let mine = tlist.filter(t =>
      (t.createdBy && t.createdBy.id === this.user.id) ||
      (t.createdBy && t.createdBy.email && this.user.email && t.createdBy.email.toLowerCase() === this.user.email.toLowerCase())
    );

    if (q) {
      mine = mine.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.id || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }
    const open = mine.filter(t => t.status === 'abierto').length;
    const prog = mine.filter(t => t.status === 'en-progreso').length;
    const res = mine.filter(t => t.status === 'resuelto').length;

    const statsRow = document.getElementById('user-stats');
    if (statsRow) {
      statsRow.innerHTML = `
        ${this.statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>', 'Total tickets', mine.length, 'var(--primary)', 'var(--primary-light)')}
        ${this.statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'Abiertos', open, 'var(--warning)', 'rgba(245, 158, 11, 0.1)')}
        ${this.statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>', 'En progreso', prog, 'var(--accent)', 'var(--accent-light)')}
        ${this.statCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', 'Resueltos', res, 'var(--success)', 'rgba(16, 185, 129, 0.1)')}
      `;
    }

    const recent = mine.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    const rl = document.getElementById('dash-recent');
    if (rl) {
      rl.innerHTML = recent.length
        ? `<div class="mini-tickets-grid">${recent.map(t => this.ticketMiniCard(t)).join('')}</div>`
        : this.emptyState('No tienes tickets aún.', 'Crea tu primer ticket para empezar.', true);
    }

    const pie = document.getElementById('dash-pie');
    if (pie) {
      const statusData = [
        { lbl: 'Abiertos', val: open, color: '#f59e0b' },
        { lbl: 'En progreso', val: prog, color: '#6366f1' },
        { lbl: 'Resueltos', val: res, color: '#10b981' },
      ].filter(d => d.val > 0);

      if (mine.length === 0) {
        pie.innerHTML = this.emptyState('Sin tickets.', 'Crea tu primera solicitud.', true);
      } else {
        pie.innerHTML = '<canvas id="user-pie-chart" style="max-height: 220px;"></canvas>';
        setTimeout(() => {
          if (this._charts['user-pie']) this._charts['user-pie'].destroy();
          const ctx = document.getElementById('user-pie-chart').getContext('2d');
          this._charts['user-pie'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: statusData.map(d => d.lbl),
              datasets: [{
                data: statusData.map(d => d.val),
                backgroundColor: statusData.map(d => d.color),
                borderWidth: 0,
                hoverOffset: 10
              }]
            },
            options: {
              cutout: '70%',
              plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, font: { family: 'Sora', weight: '600' } } },
                tooltip: { backgroundColor: '#18181b', titleFont: { family: 'Sora' }, bodyFont: { family: 'Inter' } }
              },
              animation: { animateScale: true }
            }
          });
        }, 0);
      }
    }

    if (rl) {
      rl.querySelectorAll('.ticket-mini-card').forEach(el => {
        el.addEventListener('click', () => this.openModal(el.dataset.id));
      });
    }
  },

  resetTicketForm() {
    this.selectedCategory = '';
    const catInput = document.getElementById('t-cat');
    if (catInput) catInput.value = '';
    document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('selected'));
    const form = document.getElementById('form-ticket');
    if (form) form.reset();

    const areaSelect = document.getElementById('t-area');
    if (areaSelect) {
      areaSelect.value = '';
    }
    const priorityMap = {
      'red-conectividad': 'critica', 'falla-software': 'alta',
      'acceso-permisos': 'media', 'reparacion': 'media',
      'cambio-equipo': 'baja', 'instalacion-equipo': 'baja',
      'instalacion-software': 'baja', 'otro': 'baja',
    };

    document.querySelectorAll('.cat-card').forEach(card => {
      card.onclick = () => {
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const cat = card.dataset.cat;
        if (!cat) return;
        this.selectedCategory = cat;
        if (catInput) catInput.value = cat;

        const titleInput = document.getElementById('t-title');
        if (titleInput && (!titleInput.value || Object.values(CAT_LABELS).includes(titleInput.value))) {
          titleInput.value = CAT_LABELS[cat] || '';
        }

        const prioritySelect = document.getElementById('t-priority');
        if (prioritySelect) prioritySelect.value = priorityMap[cat] || 'baja';
      };
    });

    if (form) {
      this.attachments = [];
      const attachList = document.getElementById('attachment-list');
      if (attachList) attachList.innerHTML = '';

      const az = document.getElementById('attachment-zone');
      const ai = document.getElementById('t-attachments');
      if (az && ai) {
        az.onclick = () => ai.click();
        ai.onchange = (e) => this.handleFiles(e.target.files);
        az.ondragover = (e) => { e.preventDefault(); az.classList.add('dragging'); };
        az.ondragleave = () => { az.classList.remove('dragging'); };
        az.ondrop = (e) => {
          e.preventDefault();
          az.classList.remove('dragging');
          if (e.dataTransfer.files) this.handleFiles(e.dataTransfer.files);
        };
      }

      form.onsubmit = (e) => {
        e.preventDefault();
        this.submitTicket();
      };
    }
  },

  async submitTicket() {
    const cat = this.selectedCategory;
    const title = document.getElementById('t-title').value.trim();
    const desc = document.getElementById('t-desc').value.trim();
    const priority = document.getElementById('t-priority').value;
    const area = document.getElementById('t-area').value;

    ['err-title', 'err-desc', 'err-area'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    let hasError = false;
    if (!cat) {
      this.showToast('⚠️ Selecciona una categoría (Paso 1).', 'warning');
      hasError = true;
    }
    if (!title) {
      const e = document.getElementById('err-title');
      if (e) { e.textContent = 'Escribe un título.'; e.style.display = 'block'; }
      hasError = true;
    }
    if (!desc) {
      const e = document.getElementById('err-desc');
      if (e) { e.textContent = 'Describe el problema.'; e.style.display = 'block'; }
      hasError = true;
    }
    if (!area) {
      const e = document.getElementById('err-area');
      if (e) { e.textContent = 'Selecciona tu área.'; e.style.display = 'block'; }
      hasError = true;
    }
    if (hasError) return;

    const btn = document.getElementById('btn-submit-ticket');
    const bTxt = document.getElementById('submit-txt');
    const bSpin = document.getElementById('submit-spinner');
    if (bTxt) bTxt.style.display = 'none';
    if (bSpin) bSpin.style.display = 'block';
    if (btn) btn.disabled = true;

    const newId = this.generateId();
    const now = new Date().toISOString();
    const ticket = {
      id: newId, title, category: cat, priority,
      status: 'abierto', description: desc, area,
      phone: document.getElementById('t-phone').value.trim(),
      assignedTo: 'Sin asignar',
      createdBy: { id: this.user.id, name: this.user.name, email: this.user.email },
      notes: [], attachments: this.attachments || [],
      createdAt: now, updatedAt: now,
    };

    try {
      const res = await API._fetch('/tickets', {
        method: 'POST', body: JSON.stringify(ticket)
      }).then(r => r.json());

      this.tickets = await API.getTickets();
      if (this.tickets && this.tickets.length > 0) {
        Store.saveLocal(this.tickets);
      }
      this.updateMyCounts();
      this.showToast('¡Ticket creado con éxito!', 'success');
      this.nav('my-tickets');
    } catch (err) {
      console.error('Error al enviar:', err);
      const local = Store.getLocalTickets();
      ticket.localOnly = true;
      Store.saveLocal([ticket, ...local]);
      this.tickets = Store.getLocalTickets();
      this.showToast(IS_LOCAL_FILE
        ? 'Error de Red: No se pudo conectar al servidor de Railway desde este archivo local.'
        : 'Error de Red: El servidor no responde o tu conexión es inestable.', 'error');

      this.addLocalNotification({
        id: `local-${Date.now()}`,
        title: 'Ticket Guardado (Offline)',
        message: `El ticket ${ticket.id} se guardó localmente y se subirá al volver la conexión.`,
        type: 'warning',
        timestamp: new Date().toISOString()
      });

      this.nav('my-tickets');
    } finally {
      if (btn) btn.disabled = false;
      const bTxt = document.getElementById('submit-txt');
      const bSpin = document.getElementById('submit-spinner');
      if (bTxt) bTxt.style.display = 'inline';
      if (bSpin) bSpin.style.display = 'none';
    }
  },

  renderMyTickets() {
    const tlist = this.tickets || [];
    const uid = this.user?.id;
    const umail = this.user?.email?.toLowerCase();

    let list = tlist.filter(t => {
      if (!t.createdBy || !this.user) return false;
      const t_uid = t.createdBy.id;
      const t_umail = (t.createdBy.email || t.createdBy.username || '').toLowerCase();
      return (t_uid === uid) || (t_umail && umail && (t_umail === umail || umail.includes(t_umail) || t_umail.includes(umail)));
    });

    const q = (document.getElementById('global-search')?.value || '').toLowerCase().trim();
    if (q) {
      list = list.filter(t =>
        (t.id || '').toLowerCase().includes(q) ||
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const container = document.getElementById('my-tickets-list');
    if (!container) return;

    const fStatus = document.getElementById('mf-status')?.value || '';
    const fPriority = document.getElementById('mf-priority')?.value || '';
    const fCat = document.getElementById('mf-cat')?.value || '';

    if (fStatus) list = list.filter(t => t.status === fStatus);
    if (fPriority) list = list.filter(t => t.priority === fPriority);
    if (fCat) list = list.filter(t => t.category === fCat);

    if (!list.length) {
      const hasFilter = fStatus || fPriority || fCat;
      container.innerHTML = this.emptyState(
        hasFilter ? 'Sin resultados para ese filtro.' : 'No tienes tickets aún.',
        hasFilter ? 'Cambia o elimina los filtros.' : 'Crea tu primera solicitud de soporte.',
        !hasFilter
      );
      return;
    }
    container.innerHTML = this.renderMyTicketCards(list);
    container.querySelectorAll('.view-btn').forEach(b =>
      b.addEventListener('click', () => this.openModal(b.dataset.id))
    );
  },

  renderMyTicketCards(list) {
    const rows = list.map(t => `
      <tr>
        <td><span class="tid">${t.id}</span></td>
        <td>
          <div style="font-weight:700; color:var(--t1); margin-bottom:3px; font-size:0.9rem;">${this.esc(t.title)}</div>
          <div style="font-size:11px; color:var(--t3); font-weight:600; display:flex; align-items:center; gap:4px;">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;"></span>
            ${CAT_LABELS[t.category] || (t.category || '—')}
          </div>
        </td>
        <td>${this.statusBadge(t.status)}</td>
        <td>${this.priorityBadge(t.priority)}</td>
        <td>
          <div style="font-size:12px; color:var(--t2); font-weight:600;">${this.timeAgo(t.createdAt)}</div>
          ${t.assignedTo && t.assignedTo !== 'Sin asignar' ? `<div style="font-size:10px;color:var(--t3);margin-top:2px;">Asig: ${t.assignedTo}</div>` : ''}
        </td>
        <td>
          <button class="view-btn" data-id="${t.id}" style="background:var(--primary); color:#fff; border:none; padding:9px 16px; border-radius:10px; font-weight:700; font-size:12px; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 10px rgba(79,70,229,0.25);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 14px rgba(79,70,229,0.35)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 10px rgba(79,70,229,0.25)'">
            Ver detalles →
          </button>
        </td>
      </tr>
    `).join('');
    return `
      <div style="background:var(--surface); border-radius:20px; border:1px solid var(--border); overflow:hidden; box-shadow:var(--sh-sm);">
        <table class="refined-table" style="width:100%;">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Asunto / Categoría</th>
              <th>Estado</th>
              <th>Prioridad</th>
              <th>Fecha</th>
              <th style="width:130px;"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  renderAdminDashboard() {
    const all = this.tickets;
    const open = all.filter(t => t.status === 'abierto').length;
    const prog = all.filter(t => t.status === 'en-progreso').length;
    const res = all.filter(t => t.status === 'resuelto' || t.status === 'cerrado').length;
    const crit = all.filter(t => t.priority === 'critica' && t.status !== 'cerrado').length;

    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const thisWeek = all.filter(t => new Date(t.createdAt) >= weekAgo).length;
    const resolved = all.filter(t => t.status === 'resuelto' || t.status === 'cerrado');

    let avgMin = 0;
    if (resolved.length > 0) {
      const totalMs = resolved.reduce((acc, t) => {
        const cAt = new Date(t.closedAt || t.updatedAt).getTime();
        const crAt = new Date(t.createdAt).getTime();
        return acc + (cAt - crAt);
      }, 0);
      avgMin = Math.round(totalMs / (resolved.length * 60000));
    }

    const statsMap = {
      'ad-st-total': all.length,
      'ad-st-avg': `${avgMin}m`,
      'ad-st-week': thisWeek,
      'ad-st-crit': crit
    };

    Object.entries(statsMap).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });

    const recent = (all || []).slice().sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt) : 0;
      const db = b.createdAt ? new Date(b.createdAt) : 0;
      return db - da;
    }).slice(0, 10);

    const tbody = document.querySelector('#table-admin-recent tbody');
    if (tbody) {
      tbody.innerHTML = recent.map(t => {
        const tTitle = t.title || 'Sin título';
        const tArea = t.area || 'General';
        const tUser = this.uName(t.createdBy);
        return `
            <tr>
                <td><span class="tid">${t.id}</span></td>
                <td><div style="font-weight:700">${this.esc(tTitle)}</div><div style="font-size:10px; color:var(--t3)">${CAT_LABELS[t.category] || t.category || 'Requerimiento'}</div></td>
                <td><div style="font-weight:700">${this.esc(tUser)}</div><div style="font-size:10px; color:var(--t3)">${tArea}</div></td>
                <td>${this.statusBadge(t.status)}</td>
                <td>${this.priorityBadge(t.priority)}</td>
                <td>${this.esc(t.assignedTo || '—')}</td>
                <td>${this.timeAgo(t.createdAt)}</td>
                <td><button class="icon-btn view-btn" onclick="APP.openModal('${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></td>
            </tr>
        `}).join('') || '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--t3)">No hay tickets recientes.</td></tr>';
    }

    const catEl = document.getElementById('admin-cat-chart');
    if (catEl) {
      const catCount = {};
      all.forEach(t => { catCount[t.category] = (catCount[t.category] || 0) + 1; });
      const chartData = Object.entries(CAT_LABELS).map(([key, label]) => ({
        label, count: catCount[key] || 0, color: CAT_COLORS[key] || '#64748b'
      })).filter(d => d.count > 0);

      if (all.length === 0) {
        catEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--t3)">Sin datos disponibles.</div>';
      } else {
        catEl.innerHTML = '<canvas id="admin-category-chart" style="max-height: 250px;"></canvas>';
        setTimeout(() => {
          if (this._charts['admin-cat']) this._charts['admin-cat'].destroy();
          const ctx = document.getElementById('admin-category-chart').getContext('2d');
          this._charts['admin-cat'] = new Chart(ctx, {
            type: 'pie',
            data: {
              labels: chartData.map(d => d.label),
              datasets: [{
                data: chartData.map(d => d.count),
                backgroundColor: chartData.map(d => d.color),
                borderWidth: 2,
                borderColor: localStorage.getItem('ice_darkmode') === 'true' ? '#18181b' : '#fff'
              }]
            },
            options: {
              plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, padding: 15, font: { family: 'Sora', size: 11, weight: '600' } } }
              }
            }
          });
        }, 0);
      }
    }

    const critEl = document.getElementById('admin-critical-list');
    if (critEl) {
      const critList = all.filter(t => (t.priority === 'critica' || t.priority === 'alta') && t.status !== 'cerrado').slice(0, 5);
      critEl.innerHTML = critList.map(t => `
            <div class="stat-card" style="margin-bottom:12px; cursor:pointer" onclick="APP.openModal('${t.id}')">
                <div class="stat-ico" style="background:#fef2f2; color:#ef4444"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div>
                <div>
                    <strong style="display:block; font-size:13px">${t.id}</strong>
                    <span style="font-size:11px; color:var(--t3)">${this.esc(t.title)}</span>
                </div>
            </div>`).join('') || '<p style="text-align:center; padding:20px; color:var(--t3)">Sin tickets críticos.</p>';
    }

    const dashNotice = document.getElementById('admin-dash-notice');
    if (dashNotice) {
      if (!API._up) {
        dashNotice.innerHTML = `
          <div style="background:#fff7ed; border:1.2px solid #fdba74; color:#9a3412; padding:12px 16px; border-radius:12px; margin-bottom:20px; font-size:13px; display:flex; align-items:center; gap:10px; font-weight:600;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Modo Resiliente: El servidor no responde. Los tickets mostrados son locales y podrían estar incompletos.
          </div>`;
      } else {
        dashNotice.innerHTML = '';
      }
    }
  },


  renderAdminTickets() {
    const tbody = document.querySelector('#admin-tickets-table tbody');
    if (!tbody) return;

    const qGlobal = (document.getElementById('global-search')?.value || '').toLowerCase().trim();
    const qAdmin = (document.getElementById('admin-search')?.value || '').toLowerCase().trim();
    const q = qAdmin || qGlobal;

    let filtered = this.tickets;
    if (q) {
      filtered = filtered.filter(t =>
        (t.id || '').toLowerCase().includes(q) ||
        (t.title || '').toLowerCase().includes(q) ||
        (this.uName(t.createdBy) || '').toLowerCase().includes(q) ||
        (t.area || '').toLowerCase().includes(q)
      );
    }

    tbody.innerHTML = (filtered || []).map(t => {
      const tTitle = t.title || 'Sin título';
      const tUser = this.uName(t.createdBy);
      const tArea = t.area || 'General';
      return `
        <tr>
            <td><span class="tid">${t.id}</span></td>
            <td>
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-weight:600;">${this.esc(tTitle)}</span>
                ${t.attachments && t.attachments.length > 0 ? `<span style="background:var(--primary-light); color:var(--primary); font-size:10px; padding:2px 6px; border-radius:10px; display:inline-flex; align-items:center; gap:3px; font-weight:800;" title="${t.attachments.length} archivos adjuntos">📎 ${t.attachments.length}</span>` : ''}
              </div>
              <div style="font-size:10px; color:var(--t3); margin-top:2px;">${CAT_LABELS[t.category] || t.category || 'Requerimiento'}</div>
            </td>
            <td><div>${this.esc(tUser)}</div><div style="font-size:10px; color:var(--t3)">${tArea}</div></td>
            <td>${this.statusBadge(t.status)}</td>
            <td>${this.priorityBadge(t.priority)}</td>
            <td>${this.esc(t.assignedTo || '—')}</td>
            <td>${this.timeAgo(t.createdAt)}</td>
            <td><button class="icon-btn view-btn" onclick="APP.openModal('${t.id}')">Gestionar</button></td>
        </tr>
    `}).join('') || '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--t3)">Sin registros.</td></tr>';
  },


  async renderAdminUsers() {
    const listTable = document.getElementById('admin-users-table');
    if (!listTable) return;
    this.renderAdminEmails();
    try {
      const users = await API._fetch('/admin/users').then(r => r.json());
      if (!users.length) {
        listTable.innerHTML = `<div style="padding:40px; text-align:center; color:var(--t3); border:1px dashed var(--border); border-radius:18px; background:var(--bg);">
            <div style="margin-bottom:12px; color:var(--primary); opacity:0.5;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <strong style="display:block; color:var(--t1);">No hay usuarios registrados</strong>
            <p style="font-size:13px; margin-top:4px;">Los usuarios vinculados al sistema aparecerán en este listado.</p>
          </div>`;
        return;
      }
      listTable.innerHTML = `<div class="table-wrapper"><table class="refined-table">
            <thead><tr><th>Usuario</th><th>Email</th><th>Área</th><th>Estado</th><th style="text-align:right">Acciones</th></tr></thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td>${this.esc(u.name)}</td>
                        <td>${u.email}</td>
                        <td>${u.area || '—'}</td>
                        <td><span class="badg badg-${u.active ? 'resuelto' : 'cerrado'}" style="padding:4px 8px; font-size:10px;">${u.active ? 'Activo' : 'Inactivo'}</span></td>
                        <td style="text-align:right; display:flex; gap:8px; justify-content:flex-end;">
                           <button class="icon-btn" onclick="APP._toggleUserStatus('${u.id}')" title="${u.active ? 'Desactivar' : 'Activar'}">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                 <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
                              </svg>
                           </button>
                           <button class="icon-btn" onclick="APP._deleteUser('${u.id}')" title="Eliminar" style="color:var(--t-err)">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                 <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                           </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table></div>`;
    } catch { listTable.innerHTML = '<p class="ps">Error cargando usuarios.</p>'; }
  },

  async renderAdminEmails() {
    const box = document.getElementById('admin-emails-list');
    if (!box) return;
    try {
      const resp = await API._fetch('/admin/emails');
      const emails = await resp.json();

      box.innerHTML = `
        <div style="display:flex; flex-wrap:nowrap; overflow-x:auto; padding-bottom:12px; gap:8px;">` +
        emails.map(e => `
        <div class="admin-chip" style="flex-shrink:0; display:inline-flex; align-items:center; gap:8px; margin:4px 0; padding:10px 16px; font-size:12px; background:#f0f7ff; color:#335495; border:1.8px solid #335495; border-radius:12px; font-weight:800; box-shadow:0 4px 6px -1px rgba(51,84,149,0.1);">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
           <span>${e}</span>
           <button onclick="APP._deleteAdminEmail('${e}')" style="background:none; border:none; color:#335495; cursor:pointer; display:flex; padding:2px; margin-left:4px; opacity:0.6; transition:all 0.2s;" onmouseover="this.style.opacity='1';this.style.transform='scale(1.2)'" onmouseout="this.style.opacity='0.6';this.style.transform=''">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
        </div>
      `).join('') + `</div>` || '<p style="padding:20px; text-align:center; color:var(--t3); font-size:13px; border:1px dashed var(--border); border-radius:12px;">No hay administradores registrados en este momento.</p>';
    } catch (err) {
      console.error('[ADMIN FETCH ERROR]', err);
      box.innerHTML = `<p style="padding:15px; color:#ef4444; font-size:13px; font-weight:600; text-align:center; background:#fef2f2; border:1px solid #fee2e2; border-radius:12px;">No se pudo cargar el listado. Error: ${err.message}</p>`;
    }
  },

  async _addAdminEmail() {
    const input = document.getElementById('new-admin-email');
    const email = input.value.trim();
    if (!email) return;
    try {
      await API._fetch('/admin/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      input.value = '';
      this.showToast('Administrador agregado.', 'success');
      this.renderAdminUsers();
    } catch { this.showToast('Error al agregar.', 'error'); }
  },

  async _deleteAdminEmail(email) {
    if (!confirm(`¿Revocar permisos de administrador a ${email}?`)) return;
    try {
      await API._fetch('/admin/emails', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      this.showToast('Permisos revocados.', 'info');
      this.renderAdminUsers();
    } catch { this.showToast('Error al revocar.', 'error'); }
  },

  async _toggleUserStatus(id) {
    try {
      await API._fetch(`/admin/users/toggle/${id}`, { method: 'PUT' });
      this.renderAdminUsers();
    } catch { this.showToast('Error al cambiar estado.', 'error'); }
  },

  async _deleteUser(id) {
    if (!confirm('¿Eliminar este usuario de forma permanente?')) return;
    try {
      await API._fetch(`/admin/users/${id}`, { method: 'DELETE' });
      this.showToast('Usuario eliminado.', 'info');
      this.renderAdminUsers();
    } catch { this.showToast('Error al eliminar.', 'error'); }
  },

  async renderAdminBackup() {
    const container = document.getElementById('backup-list-container');
    if (!container) return;
    try {
      const backups = await API.listBackups();
      container.innerHTML = `<table class="refined-table">
            <thead><tr><th>Archivo</th><th>Fecha</th><th>Tamaño</th><th>Acciones</th></tr></thead>
            <tbody>
                ${backups.map(b => `
                    <tr>
                        <td style="font-family:monospace">${b.filename}</td>
                        <td>${this.formatDate(b.createdAt)}</td>
                        <td>${(b.sizeBytes / 1024).toFixed(1)} KB</td>
                        <td>
                            <button class="icon-btn" onclick="API.downloadBackup('${b.filename}')">Bajar</button>
                            <button class="icon-btn" onclick="APP._restoreBackup('${b.filename}')">Restaurar</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    } catch {
      container.innerHTML = '<p style="padding:20px; color:var(--t3)">Error cargando backups.</p>';
    }
  },

  async _createManualBackup() {
    this.showToast('Creando backup...', 'info');
    try {
      await API.createBackup();
      this.showToast('Backup creado con éxito.', 'success');
      this.renderAdminBackup();
    } catch { this.showToast('Error al crear backup.', 'error'); }
  },

  async _restoreBackup(filename) {
    if (!confirm(`¿Restaurar desde ${filename}? Se borrarán los datos actuales.`)) return;
    try {
      await API.restoreBackup(filename);
      this.tickets = await API.getTickets();
      this.showToast('Datos restaurados con éxito.', 'success');
      this.renderView('dashboard');
    } catch { this.showToast('Error al restaurar el backup.', 'error'); }
  },

  bindModal() {
    const modalTicket = document.getElementById('modal-ticket');
    if (modalTicket) {
      modalTicket.addEventListener('click', e => {
        if (e.target === modalTicket) this.closeModal();
      });
    }

    const delCancel = document.getElementById('delete-cancel-btn');
    if (delCancel) delCancel.onclick = () => {
      document.getElementById('delete-confirm-modal').style.display = 'none';
      this._pendingDeleteId = null;
    };
    const delConfirm = document.getElementById('delete-confirm-btn');
    if (delConfirm) delConfirm.onclick = async () => {
      if (!this._pendingDeleteId) return;
      document.getElementById('delete-confirm-modal').style.display = 'none';
      await this.confirmDelete(this._pendingDeleteId);
      this._pendingDeleteId = null;
    };
  },

  openModal(id, isSnapshot = false, snapshotData = null) {
    const t = isSnapshot ? snapshotData : this.tickets.find(x => x.id === id);
    if (!t) return;
    this.openTicketId = id;
    const isAdmin = this.user.role === 'admin';

    const mId = document.getElementById('m-id-pill');
    const mTitle = document.getElementById('m-title');
    const mDesc = document.getElementById('m-desc');
    const mStatusBox = document.getElementById('m-status-box');
    const mPriorityBox = document.getElementById('m-priority-box');
    const mAssignBox = document.getElementById('m-assign-box');
    const mUserBox = document.getElementById('m-user-box');
    const mNotesList = document.getElementById('m-notes-list');
    const mFooter = document.getElementById('m-footer');

    if (mId) mId.textContent = isSnapshot ? `RESPALDO DE ${t.id}` : t.id;
    if (mTitle) {
      mTitle.textContent = t.title;
      if (isSnapshot) {
        mTitle.innerHTML += ' <span style="font-size: 10px; background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 6px; vertical-align: middle; margin-left: 8px;">VISTA DE HISTORIAL</span>';
      }
    }
    if (mDesc) mDesc.textContent = t.description;
    if (mStatusBox) mStatusBox.innerHTML = this.statusBadge(t.status);
    if (mPriorityBox) mPriorityBox.innerHTML = this.priorityBadge(t.priority);
    if (mUserBox) mUserBox.textContent = `${t.createdBy.name} (${t.area})`;

    const mAttach = document.getElementById('m-attachments');
    const mAttachList = document.getElementById('m-attach-list');
    if (mAttach && mAttachList) {
      const atts = t.attachments || [];
      if (atts.length > 0) {
        mAttach.style.display = 'block';
        mAttachList.innerHTML = atts.map(a => {
          const isImg = a.type && a.type.startsWith('image/');
          const clickFn = isImg ? `onclick="APP.showLightbox('${a.data}', '${this.esc(a.name)}'); return false;"` : `href="${a.data}" target="_blank"`;
          return `
            <a ${clickFn} class="attach-card" style="display:flex; cursor:pointer; flex-direction:column; background:var(--bg); border:1px solid var(--border); border-radius:10px; overflow:hidden; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--border)';this.style.transform=''">
              ${isImg ? `<img src="${a.data}" style="height:80px; width:100%; object-fit:cover;">` :
              `<div style="height:80px; display:flex; align-items:center; justify-content:center; background:var(--primary-light); color:var(--primary);">
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                 </div>`}
              <div style="padding:6px 10px; font-size:10px; font-weight:700; color:var(--t1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-top:1px solid var(--border); background:white;">
                ${this.esc(a.name)}
              </div>
            </a>
          `;
        }).join('');
      } else {
        mAttach.style.display = 'none';
      }
    }

    if (mAssignBox) {
      if (isAdmin && !isSnapshot) {
        mAssignBox.innerHTML = `
          <select id="m-assign-sel" style="width:100%; border:none; background:transparent; font-weight:700; color:var(--primary); font-family:inherit; cursor:pointer;" onchange="APP.updateAssignment('${t.id}', this.value)">
             <option value="">Sin asignar</option>
             <option value="Gustavo Velandia" ${t.assignedTo === 'Gustavo Velandia' ? 'selected' : ''}>Gustavo Velandia</option>
             <option value="Edgar Ducuara" ${t.assignedTo === 'Edgar Ducuara' ? 'selected' : ''}>Edgar Ducuara</option>
             <option value="Stiven Arevalo" ${t.assignedTo === 'Stiven Arevalo' ? 'selected' : ''}>Stiven Arevalo</option>
             <option value="Juan Ducuara" ${t.assignedTo === 'Juan Ducuara' ? 'selected' : ''}>Juan Ducuara</option>
          </select>
        `;
      } else {
        mAssignBox.textContent = t.assignedTo || 'Pendiente de asignación';
      }
    }

    if (mNotesList) {
      mNotesList.innerHTML = (t.notes || []).map(n => {
        if (n.isAi) {
          // Parse markdown-like content for preview
          const formattedText = n.text
            .replace(/### (.*)/g, '<h3>$1</h3>')
            .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

          return `
            <div class="note-card ai-note" style="padding:16px; border-radius:12px; box-shadow:var(--sh-sm);">
               <div style="font-size:0.85rem; color:var(--t2); line-height:1.6;">${formattedText}</div>
               <div style="font-size:0.7rem; font-weight:700; color:#a78bfa; margin-top:12px; text-transform:uppercase;">${this.timeAgo(n.date)}</div>
            </div>
          `;
        }
        return `
          <div class="note-card" style="padding:16px; background:white; border:1px solid var(--border); border-radius:12px; box-shadow:var(--sh-sm);">
             <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span style="font-size:0.75rem; font-weight:800; color:var(--primary);">${this.esc(n.author)}</span>
                <span style="font-size:0.7rem; font-weight:600; color:var(--t3); text-transform:uppercase;">${this.timeAgo(n.date)}</span>
             </div>
             <div style="font-size:0.85rem; color:var(--t2); line-height:1.5;">${this.esc(n.text)}</div>
          </div>
        `;
      }).join('') || `<div style="padding:20px; text-align:center; color:var(--t3); border:1px dashed var(--border); border-radius:12px;">No hay actividad registrada aún.</div>`;
    }

    if (mFooter) {
      if (isAdmin && !isSnapshot) {
        mFooter.innerHTML = `
          <div style="display:flex; align-items:center; gap:16px; width:100%; justify-content:space-between; flex-wrap:wrap;">
             <div style="display:flex; gap:8px;">
               <button onclick="APP.confirmDeleteTicket('${t.id}')" style="padding:10px 16px; border-radius:12px; border:2.2px solid #fecaca; background:#fff1f2; color:#be123c; font-weight:800; font-size:0.8rem; cursor:pointer;" title="Eliminar Ticket">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
               </button>
               <button id="ai-assist-btn" onclick="APP.askAI('${t.id}')" style="padding:10px 16px; border-radius:12px; border:2.2px solid #ddd6fe; background:#f5f3ff; color:#6d28d9; font-weight:800; font-size:0.8rem; cursor:pointer; display:flex; align-items:center; gap:8px;">
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 8v4l3 3"/></svg>
                 🤖 Asistente AI
               </button>
             </div>
             <div style="display:flex; align-items:center; gap:12px; min-width:320px; flex:1; justify-content:flex-end;">
               <div style="position:relative; flex:1; max-width:200px;">
                  <select id="m-status-sel" class="fsel" style="width:100% !important; padding:12px 16px !important; font-weight:800; border:2.2px solid var(--border-thick) !important; text-transform:uppercase; font-size:0.8rem; border-radius:12px !important;">
                    ${['abierto', 'en-progreso', 'resuelto', 'cerrado'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
                  </select>
               </div>
               <button class="btn-primary" onclick="APP.saveModal()" style="padding:13px 28px; font-weight:800; border-radius:12px; box-shadow: 0 8px 16px -4px rgba(79,70,229,0.35);">Guardar Cambios</button>
             </div>
          </div>
        `;
      } else {
        mFooter.innerHTML = `<button class="btn-ghost" onclick="APP.closeModal()" style="width:100%;">Cerrar vista ${isSnapshot ? 'de historial' : ''}</button>`;
      }
    }

    const mNoteForm = document.querySelector('.m-note-form');
    if (mNoteForm) mNoteForm.style.display = isSnapshot ? 'none' : 'flex';

    document.getElementById('modal-ticket').style.display = 'flex';
  },

  async updateAssignment(tid, staff) {
    await API.updateTicket(tid, { assignedTo: staff });
    this.tickets = await API.getTickets();
    this.showToast(`Ticket asignado a: ${staff || 'Sin asignar'}`, 'info');
    this.renderView(this.currentView);
  },

  async saveModal() {
    const s = document.getElementById('m-status-sel').value;
    await API.updateTicket(this.openTicketId, { status: s });
    this.tickets = await API.getTickets();
    this.showToast('Estado del ticket actualizado.', 'success');
    this.closeModal();
    this.renderView(this.currentView);
  },

  async addNote() {
    const val = document.getElementById('m-note-val').value.trim();
    if (!val) return;
    const t = this.tickets.find(x => x.id === this.openTicketId);
    const note = { author: this.user.name, text: val, date: new Date().toISOString() };
    const notes = [...(t.notes || []), note];

    await API.updateTicket(t.id, { notes });
    document.getElementById('m-note-val').value = '';
    this.tickets = await API.getTickets();
    this.openModal(this.openTicketId);
    this.showToast('Nota técnica agregada.', 'success');
  },

  async askAI(tid) {
    const t = this.tickets.find(x => x.id === tid);
    if (!t) return;

    const btn = document.getElementById('ai-assist-btn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px; border-top-color:var(--primary);"></span> Analizando con Gemini...';
    btn.disabled = true;

    try {
      // Simulamos la llamada a la API de IA (o la llamamos si existe el endpoint)
      // En un entorno real, esto llamaría a API._fetch('/ai/analyze', { method: 'POST', body: JSON.stringify({ ticket: t }) })
      await new Promise(r => setTimeout(r, 1800));

      const analysis = this._simulateAIAnalysis(t);

      // Mostramos el resultado en un modal o en las notas
      this.showToast('Análisis de IA completado', 'success');

      // Actualizamos la categoría si la IA sugiere una distinta y el admin lo desea
      // O simplemente mostramos la sugerencia en las notas
      const aiNote = {
        author: '🤖 Asistente Gemini AI',
        text: `### Análisis Automático\n**Categoría Sugerida:** ${analysis.category}\n**Resumen:** ${analysis.summary}\n\n**Respuesta Sugerida:**\n"${analysis.suggestion}"`,
        date: new Date().toISOString(),
        isAi: true
      };

      const notes = [...(t.notes || []), aiNote];
      await API.updateTicket(t.id, { notes });
      this.tickets = await API.getTickets();
      this.openModal(tid);

    } catch (err) {
      this.showToast('Error al conectar con la IA', 'error');
    } finally {
      btn.innerHTML = originalContent;
      btn.disabled = false;
    }
  },

  _simulateAIAnalysis(t) {
    const desc = (t.description || '').toLowerCase();
    let cat = t.category;
    let suggestion = "Hola, hemos recibido tu solicitud y un técnico la revisará pronto.";

    if (desc.includes('internet') || desc.includes('wifi') || desc.includes('red') || desc.includes('lento')) {
      cat = 'red-conectividad';
      suggestion = "Hola, parece que tienes problemas de red. Por favor, verifica si el cable de red está conectado o reinicia tu equipo mientras un técnico revisa el estado del router central.";
    } else if (desc.includes('password') || desc.includes('contraseña') || desc.includes('acceso') || desc.includes('permisos')) {
      cat = 'acceso-permisos';
      suggestion = "Hola, para restablecer tu contraseña o permisos, necesitaremos validar tu identidad. Por favor, ten a la mano tu documento de identidad para la validación remota.";
    } else if (desc.includes('pantalla') || desc.includes('teclado') || desc.includes('pc') || desc.includes('prende')) {
      cat = 'reparacion-arreglo';
      suggestion = "Hola, lamentamos el fallo en tu hardware. Un técnico se desplazará a tu puesto para revisar el equipo físicamente en los próximos 30 minutos.";
    }

    return {
      category: CAT_LABELS[cat] || cat,
      summary: t.description.length > 50 ? t.description.substring(0, 100) + '...' : t.description,
      suggestion: suggestion
    };
  },

  closeModal() {
    const m = document.getElementById('modal-ticket');
    if (m) m.style.display = 'none';
  },

  confirmDeleteTicket(id) {
    const t = this.tickets.find(x => x.id === id);
    if (!t) return;
    this._pendingDeleteId = id;
    const msg = document.getElementById('delete-confirm-msg');
    if (msg) msg.textContent = `Se eliminará permanentemente "${t.title}" (${t.id}).`;
    document.getElementById('delete-confirm-modal').style.display = 'flex';
  },

  async confirmDelete(id) {
    try {
      await API.deleteTicket(id, this.user);
      this.tickets = await API.getTickets();
      this.closeModal();
      this.renderView(this.currentView);
      this.showToast('Ticket eliminado correctamente.', 'success');
    } catch {
      this.showToast('Error al eliminar el ticket.', 'error');
    }
  },

  bindGlobalSearch() {
    const inp = document.getElementById('global-search');
    if (!inp) return;

    inp.oninput = () => {
      const q = inp.value.toLowerCase().trim();
      if (!this.user) return;

      if (this.currentView === 'dashboard' || this.currentView === 'my-tickets' || this.currentView === 'admin-tickets') {
        this.renderView(this.currentView);
      }
    };
  },

  statCard(icon, label, value, color, bg) {
    return `<div class="stat-card"><div class="stat-ico" style="background:${bg}; color:${color}">${icon}</div><div class="stat-detail"><div class="stat-val">${value}</div><div class="stat-lbl">${label}</div></div></div>`;
  },

  ticketMiniCard(t) {
    return `
      <div class="ticket-mini-card" data-id="${t.id}" onclick="APP.openModal('${t.id}')">
        <div style="display:flex; justify-content:space-between; align-items:start;">
           <span style="font-size:10px; font-weight:800; color:var(--primary); background:var(--primary-light); padding:3px 8px; border-radius:6px; font-family:monospace;">${t.id}</span>
           ${this.statusBadge(t.status)}
        </div>
        <div style="flex:1;">
           <h4 style="margin:0; font-size:0.92rem; font-weight:700; color:var(--t1); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${this.esc(t.title)}</h4>
           <div style="font-size:11px; color:var(--t3); font-weight:600; margin-top:4px;">${CAT_LABELS[t.category] || t.category}</div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:10px; border-top:1px solid var(--border-muted);">
           <div style="display:flex; align-items:center; gap:4px; font-size:10px; color:var(--t2); font-weight:600;">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
             ${this.timeAgo(t.createdAt)}
           </div>
           ${this.priorityBadge(t.priority)}
        </div>
      </div>`;
  },

  ticketsTable(list, isAdmin) {
    const rows = list.map(t => `
      <tr onclick="APP.openModal('${t.id}')" style="cursor:pointer;">
        <td><span class="tid">${t.id}</span></td>
        <td>
          <div style="font-weight:700; color:var(--t1);">${this.esc(t.title)}</div>
          <div style="font-size:10px; color:var(--t3); font-weight:600;">${CAT_LABELS[t.category] || t.category}</div>
        </td>
        ${isAdmin ? `<td><div style="font-weight:600; color:var(--t2);">${this.esc(t.createdBy.name)}</div><div style="font-size:9px; color:var(--t3);">${t.area || ''}</div></td>` : ''}
        <td>${this.statusBadge(t.status)}</td>
        <td>${this.priorityBadge(t.priority)}</td>
        <td style="font-size:11px; color:var(--t3); font-weight:700;">${this.timeAgo(t.createdAt)}</td>
        <td><button class="icon-btn" style="background:var(--primary-light); color:var(--primary); font-weight:800; border-radius:8px; padding:6px 12px; font-size:11px;">Gestionar</button></td>
      </tr>
    `).join('');
    return `
      <div style="background:var(--surface); border-radius:18px; border:1px solid var(--border); overflow:hidden; box-shadow:var(--sh-sm);">
        <table class="refined-table" style="width:100%;">
          <thead>
            <tr>
              <th>ID</th>
              <th>Solicitud</th>
              ${isAdmin ? '<th>Usuario</th>' : ''}
              <th>Estado</th>
              <th>Prioridad</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  statusBadge(s) {
    const label = STATUS_LABELS[s] || s;
    return `<span class="pill ${s}">${label.toUpperCase()}</span>`;
  },
  priorityBadge(p) {
    const label = PRIORITY_LABELS[p.toLowerCase()] || p;
    return `<span class="pill ${p.toLowerCase()}">${label.toUpperCase()}</span>`;
  },

  emptyState(title, sub = '', showBtn = false) {
    return `
      <div class="empty-state" style="padding:60px 20px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:16px;">
        <div style="width:70px; height:70px; background:var(--bg); border-radius:24px; display:flex; align-items:center; justify-content:center; color:var(--t3); margin-bottom:8px; border:1px solid var(--border);">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <strong style="font-size:1.1rem; color:var(--t1);">${title}</strong>
        <p style="color:var(--t3); font-size:14px; margin:0; max-width:320px; line-height:1.5;">${sub}</p>
        ${showBtn ? `<button class="btn-primary" onclick="APP.nav('new-ticket')" style="margin-top:8px;">Crear Solicitud</button>` : ''}
      </div>`;
  },

  quickSupport() {
    this.nav('new-ticket');
    setTimeout(() => {
      document.getElementById('t-priority').value = 'critica';
      document.getElementById('t-desc').placeholder = '¡EMERGENCIA IT! Detalles aquí...';
    }, 100);
  },

  generateId() {
    const max = this.tickets.reduce((mx, t) => {
      const match = t.id.match(/#(\d+)$/);
      const n = match ? parseInt(match[1], 10) : 0;
      return Math.max(mx, n);
    }, 0);
    return `Ticket #${max + 1}`;
  },

  formatDate(iso) { return iso ? new Date(iso).toLocaleDateString() : '—'; },
  timeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso)) / 60000;
    if (diff < 1) return 'Ahora';
    if (diff < 60) return `Hace ${Math.floor(diff)} min`;
    const h = diff / 60;
    if (h < 24) return `Hace ${Math.floor(h)} h`;
    return `Hace ${Math.floor(h / 24)} d`;
  },

  uName(u) {
    if (!u) return '—';
    const name = u.name || '';
    if (name === 'Usuario Corporativo' || name === 'Usuario Microsoft' || !name) {
      return u.email ? u.email.split('@')[0] : 'Usuario';
    }
    return name;
  },

  esc(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

  showToast(msg, type = 'info') {
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<div class="toast-msg">${msg}</div>`;
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => t.remove(), 400);
    }, 3600);
  },

  async fetchNotifications() {
    if (!this.user) return;
    const box = document.getElementById('notif-list');
    if (box && !box.innerHTML.trim()) {
      box.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--t3);"><div class="spinner" style="margin:0 auto 10px;"></div>Cargando...</div>';
    }
    try {
      const resp = await API._fetch('/notifications');
      const list = await resp.json();

      const localNotifs = Store.getLocalNotifications();
      const combined = [...localNotifs, ...list].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      const unreadList = combined.filter(n => !n.read);
      if (unreadList.length > 0) {
        const newest = unreadList[0];
        if (this._lastNotifId !== newest.id) {
          this._lastNotifId = newest.id;
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(newest.title, { body: newest.message, icon: 'assets/logo-iceberg.png' });
          }
        }
      }

      this.renderNotifications(combined);
    } catch (err) {
      console.error('[NOTIF FETCH ERR]', err);
      const localNotifs = Store.getLocalNotifications();
      if (localNotifs.length > 0) {
        this.renderNotifications(localNotifs);
      } else {
        this.renderNotifications([], true);
      }
    }
  },

  addLocalNotification(n) {
    const local = Store.getLocalNotifications();
    local.unshift({ ...n, read: false });
    Store.saveLocalNotifications(local.slice(0, 20));
    this.fetchNotifications();
  },

  renderNotifications(list, isErr = false) {
    const badge = document.getElementById('notif-badge');
    const box = document.getElementById('notif-list');

    if (isErr && box) {
      box.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--error); font-size:0.85rem; font-weight:600;">⚠️ Error de conexión con el servidor de notificaciones</div>';
      return;
    }

    const unread = list.filter(n => !n.read).length;


    if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'flex' : 'none'; }
    if (box) {
      if (!list.length) { box.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--t3); font-size:0.85rem;">No tienes mensajes nuevos</div>'; return; }
      box.innerHTML = list.map(n => {
        const isWarn = n.type === 'warning';
        const icon = isWarn ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" style="color:var(--error);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" style="color:var(--primary);"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
        return `
            <div class="notif-item ${n.read ? '' : 'unread'}" onclick="APP.readNotif('${n.id}', '${n.ticketId}')">
                <div class="ni-icon">${icon}</div>
                <div class="ni-content">
                    <div class="ni-title">${this.esc(n.title)}</div>
                    <div class="ni-msg">${this.esc(n.message)}</div>
                    <div class="ni-time">${this.timeAgo(n.timestamp)}</div>
                </div>
            </div>
            `;
      }).join('');
    }
  },

  async readNotif(id, tid) {
    await API._fetch(`/notifications/${id}/read`, { method: 'POST' });
    document.getElementById('notif-panel').classList.remove('active');
    if (tid) this.openModal(tid);
    this.fetchNotifications();
  },

  async renderAuditLogs() {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    try {
      const logs = await API.getAuditLogs();
      tbody.innerHTML = logs.map((l, idx) => {
        const hasSnapshot = !!l.snapshot;
        return `
        <tr>
          <td style="font-size:11px; color:var(--t3)">${new Date(l.timestamp).toLocaleString()}</td>
          <td style="font-weight:700">${this.esc(l.actor)}</td>
          <td><span class="pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1">${l.action}</span></td>
          <td><span class="tid">${l.targetId}</span></td>
          <td style="font-size:12px">
            ${this.esc(l.details)}
            ${hasSnapshot ? `<button class="btn-ghost" onclick="APP.viewAuditSnapshot(${idx})" style="padding:2px 8px; font-size:10px; margin-left:8px; border:1px solid var(--border);">📂 VER RESPALDO</button>` : ''}
          </td>
        </tr>
      `}).join('') || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--t3)">Sin registros de auditoría.</td></tr>';
      this._auditLogsCache = logs; 
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
    }
  },

  viewAuditSnapshot(idx) {
    const log = this._auditLogsCache[idx];
    if (!log || !log.snapshot) return;
    const t = log.snapshot;

    const modal = document.getElementById('modal-ticket');
    this.openModal(t.id, true, t); 
  },

  bindNotifications() {
    const btn = document.getElementById('notif-btn');
    const p = document.getElementById('notif-panel');
    if (btn) btn.onclick = e => { 
      e.stopPropagation(); 
      p.classList.toggle('active'); 
      if (p.classList.contains('active')) this.fetchNotifications(); 
    };

    const markAllBtn = document.getElementById('notif-read-all');
    if (markAllBtn) {
      markAllBtn.onclick = async (e) => {
        if (e) e.stopPropagation();
        
        const local = Store.getLocalNotifications();
        local.forEach(n => n.read = true);
        Store.saveLocalNotifications(local);

        try {
          await API._fetch('/notifications/read-all', { method: 'POST' });
        } catch (err) {
          console.warn('[NOTIF READ-ALL ERR]', err);
        }

        this.fetchNotifications();
      };
    }

    document.onclick = () => p.classList.remove('active');
    setInterval(() => {
      if (document.visibilityState === 'visible') this.fetchNotifications();
    }, 10000);
  },


  async syncOfflineTickets() {
    if (!API._up || !API._dbConnected) return;
    const local = Store.getLocalTickets();
    const offline = local.filter(t => t.localOnly);
    if (!offline.length) return;

    this.showToast(`Sincronizando ${offline.length} tickets pendientes…`, 'info');
    let count = 0;
    for (const t of offline) {
      try {
        const tCopy = { ...t };
        delete tCopy.localOnly;
        const res = await API._fetch('/tickets', { method: 'POST', body: JSON.stringify(tCopy) });
        if (res.ok) { t.localOnly = false; count++; }
      } catch (err) { console.error('[SYNC ERR]', err); }
    }
    if (count > 0) {
      Store.saveLocal(local);
      this.showToast(`Sincronización completa: ${count} tickets subidos.`, 'success');
    }
  },

  changeServerURL() {
    const current = API_URL;
    const n = prompt("Configuración de Servidor (URL del Backend):", current);
    if (n !== null) {
      localStorage.setItem('ice_api_override', n);
      window.location.reload();
    }
  },

  async handleFiles(files) {
    if (!files || !files.length) return;
    const current = this.attachments || [];
    if (current.length + files.length > 3) {
      this.showToast('⚠️ Máximo 3 archivos por ticket.', 'warning');
      return;
    }

    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        this.showToast(`⚠️ "${file.name}" excede los 2MB.`, 'warning');
        continue;
      }
      const exists = current.some(a => a.name === file.name && a.size === file.size);
      if (exists) continue;

      try {
        const base64 = await this.toBase64(file);
        this.attachments.push({
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64
        });
      } catch (e) {
        console.error('Error base64:', e);
        this.showToast(`❌ Error al procesar "${file.name}"`, 'error');
      }
    }
    this.renderAttachmentList();
  },

  toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  },

  renderAttachmentList() {
    const list = document.getElementById('attachment-list');
    if (!list) return;
    list.innerHTML = this.attachments.map((a, i) => {
      const isImg = a.type.startsWith('image/');
      const icon = isImg ? `<img src="${a.data}" class="attach-thumb">` :
        `<div class="attach-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--primary)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>`;
      return `
        <div class="attach-item">
          ${icon}
          <div class="attach-info">
            <span class="attach-name">${this.esc(a.name)}</span>
            <span class="attach-meta">${(a.size / 1024).toFixed(1)} KB</span>
          </div>
          <button type="button" class="btn-remove-attach" onclick="APP.removeAttachment(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
    }).join('');
  },

  removeAttachment(index) {
    this.attachments.splice(index, 1);
    this.renderAttachmentList();
  },

  showLightbox(data, name) {
    let lb = document.getElementById('lightbox-modal');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'lightbox-modal';
      lb.className = 'modal-bd';
      lb.style.cssText = `
        position:fixed; top:0; left:0; width:100%; height:100%; 
        background:rgba(15,23,42,0.95); z-index:10000; display:none; 
        align-items:center; justify-content:center; backdrop-filter:blur(10px);
        transition:all 0.3s ease; cursor:zoom-out;
      `;
      lb.onclick = (e) => { if (e.target === lb || e.target.closest('button')) { lb.style.opacity = '0'; setTimeout(() => { lb.style.display = 'none'; lb.innerHTML = '' }, 200); } };
      document.body.appendChild(lb);
    }
    lb.style.display = 'flex';
    lb.style.opacity = '0';
    setTimeout(() => lb.style.opacity = '1', 10);

    lb.innerHTML = `
      <div style="position:relative; max-width:95%; max-height:95%; display:flex; flex-direction:column; align-items:center; animation:zoomIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
        <img src="${data}" style="max-width:100%; max-height:80vh; border-radius:12px; border:4px solid white; box-shadow:0 0 50px rgba(0,0,0,0.5); object-fit:contain;">
        <div style="margin-top:20px; color:white; display:flex; gap:10px; align-items:center;">
          <span style="font-weight:700; background:rgba(255,255,255,0.1); padding:8px 20px; border-radius:30px; border:1px solid rgba(255,255,255,0.2);">${name}</span>
          <a href="${data}" target="_blank" download="${name}" style="background:var(--primary); color:white; text-decoration:none; padding:8px 20px; border-radius:30px; font-weight:700; font-size:13px; box-shadow:0 4px 12px var(--shadow);">Ver Tamaño Real / Descargar</a>
        </div>
        <button style="position:absolute; top:-60px; right:0; background:rgba(255,255,255,0.1); border:none; color:white; cursor:pointer; width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  },

  async testEmail() {
    const btn = document.getElementById('btn-test-email');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner-small"></span> Enviando...';
    }
    try {
      const res = await API._fetch('/admin/test-email', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showToast('¡Correo de prueba enviado con éxito! Revisa tu bandeja de entrada.', 'success');
      } else {
        this.showToast('El servidor no pudo enviar el correo. Verifica las credenciales en el archivo .env.', 'error');
      }
    } catch (e) {
      this.showToast('Error de conexión con el servidor al intentar enviar el correo.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2L15 22 11 13 2 9 22 2"/></svg> Enviar correo de prueba';
      }
    }
  }
};



window.APP = APP;
document.addEventListener('DOMContentLoaded', () => {
  APP.init().then(() => {
  });
});

