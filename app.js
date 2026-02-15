
'use strict';

var RUNTIME_CONFIG = (typeof window !== 'undefined' && window.FLUX_CONFIG) ? window.FLUX_CONFIG : {};

var CONFIG = {
  SUPABASE_URL: RUNTIME_CONFIG.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: RUNTIME_CONFIG.SUPABASE_ANON_KEY || '',
  SUPABASE_TABLE: 'transactions',
  GOOGLE_CLIENT_ID: RUNTIME_CONFIG.GOOGLE_CLIENT_ID || '',
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  GOOGLE_TAB: 'Transactions',
  GOOGLE_HEADERS: ['ID', 'Date', 'Intitule', 'Montant', 'Type', 'Categorie', 'Note', 'Timestamp'],
  ENABLE_DEMO_DATA: false,
  CHART_COLORS: ['#4C6FFF', '#00D68F', '#FF4D6A', '#FFB830', '#14B8A6', '#F97316', '#EC4899', '#3B82F6', '#6B7280'],
  CATEGORIES: {
    Depense: ['Alimentation', 'Logement', 'Transport', 'Sante', 'Education', 'Loisirs', 'Vetements', 'Communication', 'Epargne', 'Autre depense'],
    Recette: ['Salaire', 'Freelance', 'Commerce', 'Agriculture', 'Transfert recu', 'Investissement', 'Aide', 'Autre recette']
  }
};

var state = {
  transactions: [],
  currentType: 'Depense',
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  sortField: 'date',
  sortDir: 'desc',
  charts: { donut: null, bar: null, line: null, savings: null },
  cloud: { enabled: false, client: null, user: null },
  google: { enabled: false, tokenClient: null, token: '', sheetId: '', connected: false }
};

function $(id) { return document.getElementById(id); }
function bySelAll(s) { return document.querySelectorAll(s); }
function hasChart() { return typeof window.Chart !== 'undefined'; }

function fmtAmount(n) { return new Intl.NumberFormat('fr-FR').format(Math.abs(Math.round(Number(n) || 0))) + ' FCFA'; }
function fmtDate(iso) {
  if (!iso) return '-';
  var d = new Date(String(iso) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function monthKey(iso) { return iso ? String(iso).slice(0, 7) : ''; }
function monthLabel(y, m) { return new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function saveTransactions() { try { localStorage.setItem('flux_transactions', JSON.stringify(state.transactions)); } catch (e) {} }
function loadTransactions() {
  try {
    var raw = localStorage.getItem('flux_transactions');
    var parsed = raw ? JSON.parse(raw) : [];
    state.transactions = Array.isArray(parsed) ? parsed : [];
  } catch (e) { state.transactions = []; }
}
function saveGoogleSheetId(id) { try { localStorage.setItem('flux_google_sheet_id', id || ''); } catch (e) {} }
function loadGoogleSheetId() { try { return localStorage.getItem('flux_google_sheet_id') || ''; } catch (e) { return ''; } }

function showToast(type, msg) {
  var t = $('toast');
  if (!t) return;
  t.className = 'toast ' + (type || 'success');
  var m = $('toastMsg');
  if (m) m.textContent = msg;
  if (showToast._timer) clearTimeout(showToast._timer);
  showToast._timer = setTimeout(hideToast, 3500);
}
function hideToast() { var t = $('toast'); if (t) t.className = 'toast hidden'; }

function updateMonthLabel() { var el = $('monthLabel'); if (el) el.textContent = monthLabel(state.currentYear, state.currentMonth); }
function updateTxnBadge() { var b = $('txnBadge'); if (b) b.textContent = String(state.transactions.length); }

function lockBody() { document.body.classList.add('body-lock'); }
function unlockBodyIfNeeded() {
  var sidebarOpen = $('sidebar') && $('sidebar').classList.contains('open');
  var authOpen = $('authModalBackdrop') && !$('authModalBackdrop').classList.contains('hidden');
  var googleOpen = $('googleModalBackdrop') && !$('googleModalBackdrop').classList.contains('hidden');
  if (!sidebarOpen && !authOpen && !googleOpen) document.body.classList.remove('body-lock');
}
function openSidebar() { var s = $('sidebar'); var o = $('overlay'); if (s) s.classList.add('open'); if (o) o.classList.add('visible'); lockBody(); }
function closeSidebar() { var s = $('sidebar'); var o = $('overlay'); if (s) s.classList.remove('open'); if (o) o.classList.remove('visible'); unlockBodyIfNeeded(); }

function navigateTo(viewId) {
  var views = bySelAll('.view');
  for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
  var links = bySelAll('.nav-link');
  for (var j = 0; j < links.length; j++) links[j].classList.remove('active');

  var v = $('view-' + viewId);
  if (v) v.classList.add('active');

  var match = bySelAll('[data-view="' + viewId + '"]');
  for (var k = 0; k < match.length; k++) if (match[k].classList.contains('nav-link')) match[k].classList.add('active');
  for (var a = 0; a < links.length; a++) {
    if (links[a].classList.contains('active')) links[a].setAttribute('aria-current', 'page');
    else links[a].removeAttribute('aria-current');
  }

  var titles = { dashboard: 'Tableau de bord', add: 'Nouvelle operation', history: 'Historique', analytics: 'Analytiques', account: 'Utilisateur' };
  var topTitle = $('topbarTitle');
  if (topTitle) topTitle.textContent = titles[viewId] || 'Flux';

  if (viewId === 'dashboard') refreshDashboard();
  if (viewId === 'history') refreshHistory();
  if (viewId === 'analytics') refreshAnalytics();
  closeSidebar();
}

function initNavigation() {
  var nodes = bySelAll('[data-view]');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].addEventListener('click', function (e) {
      e.preventDefault();
      var id = this.getAttribute('data-view');
      if (id) navigateTo(id);
    });
  }

  if ($('mobileMenuBtn')) $('mobileMenuBtn').addEventListener('click', openSidebar);
  if ($('sidebarToggle')) $('sidebarToggle').addEventListener('click', closeSidebar);
  if ($('overlay')) $('overlay').addEventListener('click', closeSidebar);

  if ($('prevMonth')) $('prevMonth').addEventListener('click', function () {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    updateMonthLabel();
    refreshDashboard();
    if ($('view-analytics') && $('view-analytics').classList.contains('active')) refreshAnalytics();
  });

  if ($('nextMonth')) $('nextMonth').addEventListener('click', function () {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    updateMonthLabel();
    refreshDashboard();
    if ($('view-analytics') && $('view-analytics').classList.contains('active')) refreshAnalytics();
  });
}
function setType(type) {
  state.currentType = type;
  if ($('btnDepense')) $('btnDepense').classList.toggle('active', type === 'Depense');
  if ($('btnRecette')) $('btnRecette').classList.toggle('active', type === 'Recette');

  var sel = $('fieldCategorie');
  if (!sel) return;
  sel.innerHTML = '';
  var p = document.createElement('option'); p.value = ''; p.textContent = '-- Selectionner --'; sel.appendChild(p);
  var cats = CONFIG.CATEGORIES[type] || [];
  for (var i = 0; i < cats.length; i++) {
    var o = document.createElement('option'); o.value = cats[i]; o.textContent = cats[i]; sel.appendChild(o);
  }
}

function resetForm() {
  if ($('fieldDate')) $('fieldDate').value = new Date().toISOString().slice(0, 10);
  if ($('fieldIntitule')) $('fieldIntitule').value = '';
  if ($('fieldMontant')) $('fieldMontant').value = '';
  if ($('fieldCategorie')) $('fieldCategorie').value = '';
  if ($('fieldNote')) $('fieldNote').value = '';
  if ($('charCount')) $('charCount').textContent = '0';
  setType('Depense');
  hideToast();
  var fields = bySelAll('.field');
  for (var i = 0; i < fields.length; i++) fields[i].classList.remove('error');
}

function validateForm() {
  var ids = ['fieldDate', 'fieldIntitule', 'fieldMontant', 'fieldCategorie'];
  var ok = true;
  for (var i = 0; i < ids.length; i++) {
    var el = $(ids[i]);
    if (!el) continue;
    var empty = !String(el.value || '').trim();
    if (ids[i] === 'fieldMontant') {
      var n = parseFloat(el.value);
      if (!isFinite(n) || n <= 0) empty = true;
    }
    el.classList.toggle('error', empty);
    if (empty) ok = false;
  }
  return ok;
}

function setLoading(flag) {
  var btn = $('btnSubmit');
  if (!btn) return;
  btn.disabled = !!flag;
  var t = btn.querySelector('.btn-text');
  var s = btn.querySelector('.btn-spinner');
  if (t) t.classList.toggle('hidden', !!flag);
  if (s) s.classList.toggle('hidden', !flag);
}

function mergeTransactions(local, remote) {
  var map = {};
  var all = [].concat(local || [], remote || []);
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    if (!t || !t.id) continue;
    var cur = map[t.id];
    if (!cur) { map[t.id] = t; continue; }
    var a = Date.parse(cur.timestamp || '') || 0;
    var b = Date.parse(t.timestamp || '') || 0;
    map[t.id] = b >= a ? t : cur;
  }
  var out = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return out;
}

function cloudConfigured() {
  return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
}

function updateCloudStatus(msg) { if ($('cloudStatus')) $('cloudStatus').textContent = msg; }

function updateCloudUiState() {
  var enabled = state.cloud.enabled;
  var logged = !!state.cloud.user;
  if ($('accountBtn')) $('accountBtn').disabled = !enabled;
  if ($('cloudSyncBtn')) $('cloudSyncBtn').disabled = !enabled || !logged;
  if ($('authUserLabel')) $('authUserLabel').textContent = logged ? state.cloud.user.email : 'Non connecte';

  if (!enabled) updateCloudStatus('Cloud: non configure');
  else if (logged) updateCloudStatus('Cloud: connecte (' + state.cloud.user.email + ')');
  else updateCloudStatus('Cloud: pret (connexion requise)');
}

function openAuthModal() { if ($('authModalBackdrop')) $('authModalBackdrop').classList.remove('hidden'); lockBody(); }
function closeAuthModal() { if ($('authModalBackdrop')) $('authModalBackdrop').classList.add('hidden'); unlockBodyIfNeeded(); }

function mapToCloudRow(t) {
  return { id: t.id, user_id: state.cloud.user.id, date: t.date, intitule: t.intitule, montant: t.montant, type: t.type, categorie: t.categorie, note: t.note || '', timestamp: t.timestamp || new Date().toISOString() };
}

function mapFromCloudRow(r) {
  return { id: String(r.id), date: String(r.date), intitule: String(r.intitule), montant: Number(r.montant) || 0, type: String(r.type), categorie: String(r.categorie), note: String(r.note || ''), timestamp: String(r.timestamp || '') };
}

function cloudPullTransactions() {
  return state.cloud.client
    .from(CONFIG.SUPABASE_TABLE)
    .select('id,date,intitule,montant,type,categorie,note,timestamp')
    .eq('user_id', state.cloud.user.id)
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      var list = Array.isArray(res.data) ? res.data : [];
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(mapFromCloudRow(list[i]));
      return out;
    });
}

function cloudPushTransactions(list) {
  if (!list || !list.length) return Promise.resolve();
  var payload = [];
  for (var i = 0; i < list.length; i++) payload.push(mapToCloudRow(list[i]));
  return state.cloud.client.from(CONFIG.SUPABASE_TABLE).upsert(payload, { onConflict: 'user_id,id' }).then(function (res) {
    if (res.error) throw new Error(res.error.message);
  });
}

function cloudSyncAll() {
  if (!state.cloud.enabled || !state.cloud.user) { showToast('error', 'Connexion cloud requise.'); return Promise.resolve(); }
  return cloudPullTransactions().then(function (remote) {
    var merged = mergeTransactions(state.transactions, remote);
    return cloudPushTransactions(merged).then(function () {
      state.transactions = merged;
      saveTransactions(); updateTxnBadge(); refreshDashboard();
      if ($('view-history').classList.contains('active')) refreshHistory();
      if ($('view-analytics').classList.contains('active')) refreshAnalytics();
      showToast('success', 'Synchronisation cloud terminee.');
    });
  }).catch(function (e) { showToast('error', 'Erreur cloud: ' + e.message); });
}

function cloudPushOne(tx) {
  if (!state.cloud.enabled || !state.cloud.user) return Promise.resolve(false);
  return cloudPushTransactions([tx]).then(function () { return true; }).catch(function () { return false; });
}
function authSignup() {
  if (!state.cloud.enabled) return;
  var email = String((($('authEmail') || {}).value) || '').trim();
  var pass = String((($('authPassword') || {}).value) || '').trim();
  if (!email || pass.length < 6) { showToast('error', 'Email et mot de passe (min 6) requis.'); return; }
  state.cloud.client.auth.signUp({ email: email, password: pass }).then(function (res) {
    if (res.error) showToast('error', 'Inscription: ' + res.error.message);
    else showToast('success', 'Inscription validee. Verifiez votre email si demande.');
  });
}

function authLogin() {
  if (!state.cloud.enabled) return;
  var email = String((($('authEmail') || {}).value) || '').trim();
  var pass = String((($('authPassword') || {}).value) || '').trim();
  if (!email || !pass) { showToast('error', 'Email et mot de passe requis.'); return; }
  state.cloud.client.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
    if (res.error) { showToast('error', 'Connexion: ' + res.error.message); return; }
    state.cloud.user = res.data && res.data.user ? res.data.user : null;
    updateCloudUiState();
    cloudSyncAll();
    closeAuthModal();
  });
}

function authLogout() {
  if (!state.cloud.enabled) return;
  state.cloud.client.auth.signOut().then(function () {
    state.cloud.user = null;
    updateCloudUiState();
    showToast('success', 'Compte deconnecte.');
  });
}

function initCloud() {
  state.cloud.enabled = cloudConfigured();
  if (!state.cloud.enabled) { updateCloudUiState(); return; }

  state.cloud.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  state.cloud.client.auth.getSession().then(function (res) {
    state.cloud.user = res && res.data && res.data.session ? res.data.session.user : null;
    updateCloudUiState();
    if (state.cloud.user) cloudSyncAll();
  });

  state.cloud.client.auth.onAuthStateChange(function (_evt, session) {
    state.cloud.user = session ? session.user : null;
    updateCloudUiState();
  });

  if ($('accountBtn')) $('accountBtn').addEventListener('click', openAuthModal);
  if ($('cloudSyncBtn')) $('cloudSyncBtn').addEventListener('click', function () { cloudSyncAll(); });
  if ($('authModalClose')) $('authModalClose').addEventListener('click', closeAuthModal);
  if ($('authSignupBtn')) $('authSignupBtn').addEventListener('click', authSignup);
  if ($('authLoginBtn')) $('authLoginBtn').addEventListener('click', authLogin);
  if ($('authLogoutBtn')) $('authLogoutBtn').addEventListener('click', authLogout);

  if ($('authEmail')) $('authEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); authLogin(); } });
  if ($('authPassword')) $('authPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); authLogin(); } });
  if ($('authModalBackdrop')) $('authModalBackdrop').addEventListener('click', function (e) { if (e.target && e.target.id === 'authModalBackdrop') closeAuthModal(); });

  updateCloudUiState();
}

function extractSheetId(v) {
  var t = String(v || '').trim();
  if (!t) return '';
  var m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && m[1]) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(t)) return t;
  return '';
}

function updateGoogleStatus(msg) { if ($('googleStatus')) $('googleStatus').textContent = msg; }

function updateGoogleUiState() {
  var connected = !!(state.google.connected && state.google.sheetId);
  if ($('googleConnectBtn')) $('googleConnectBtn').textContent = connected ? 'Reconnect Google' : 'Connexion Google';
  if ($('googleSyncBtn')) $('googleSyncBtn').disabled = !connected;
  if ($('googleDisconnectBtn')) $('googleDisconnectBtn').disabled = !connected;

  if (!state.google.enabled) updateGoogleStatus('Google: desactive (client id manquant)');
  else if (connected) updateGoogleStatus('Google: connecte (' + state.google.sheetId + ')');
  else updateGoogleStatus('Google: pret (connexion requise)');
}

function openGoogleModal() {
  if ($('googleModalBackdrop')) $('googleModalBackdrop').classList.remove('hidden');
  if ($('googleSheetUrlModal')) $('googleSheetUrlModal').value = state.google.sheetId || '';
  lockBody();
}

function closeGoogleModal() { if ($('googleModalBackdrop')) $('googleModalBackdrop').classList.add('hidden'); unlockBodyIfNeeded(); }

function ensureGoogleToken(interactive) {
  if (!state.google.enabled) return Promise.reject(new Error('Google non configure'));
  if (state.google.token) return Promise.resolve(state.google.token);
  if (!window.google || !google.accounts || !google.accounts.oauth2) return Promise.reject(new Error('Google Identity Service non charge'));

  if (!state.google.tokenClient) {
    state.google.tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CONFIG.GOOGLE_CLIENT_ID, scope: CONFIG.GOOGLE_SCOPES, callback: function () {} });
  }

  return new Promise(function (resolve, reject) {
    state.google.tokenClient.callback = function (resp) {
      if (resp && resp.access_token) { state.google.token = resp.access_token; resolve(state.google.token); }
      else reject(new Error('OAuth Google refuse'));
    };
    state.google.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

function sheetsApi(path, options, interactive) {
  return ensureGoogleToken(!!interactive).then(function (token) {
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + state.google.sheetId + '/' + path;
    var opts = options || {};
    var headers = opts.headers || {};
    headers.Authorization = 'Bearer ' + token;
    headers['Content-Type'] = 'application/json';
    opts.headers = headers;

    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { state.google.token = ''; return sheetsApi(path, options, true); }
      if (!r.ok) throw new Error('Sheets API ' + r.status);
      if (r.status === 204) return null;
      return r.json();
    });
  });
}
function ensureGoogleSheet() {
  return sheetsApi('?fields=sheets.properties.title').then(function (meta) {
    var sheets = meta && meta.sheets ? meta.sheets : [];
    var exists = false;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i] && sheets[i].properties && sheets[i].properties.title === CONFIG.GOOGLE_TAB) { exists = true; break; }
    }

    var p = Promise.resolve();
    if (!exists) {
      p = sheetsApi(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CONFIG.GOOGLE_TAB } } }] }) });
    }

    return p.then(function () {
      var range = encodeURIComponent(CONFIG.GOOGLE_TAB + '!A1:H1');
      return sheetsApi('values/' + range).then(function (head) {
        var values = (head && head.values && head.values[0]) ? head.values[0] : [];
        if (values.join('|') === CONFIG.GOOGLE_HEADERS.join('|')) return;
        return sheetsApi('values/' + range + '?valueInputOption=RAW', {
          method: 'PUT',
          body: JSON.stringify({ range: CONFIG.GOOGLE_TAB + '!A1:H1', majorDimension: 'ROWS', values: [CONFIG.GOOGLE_HEADERS] })
        });
      });
    });
  });
}

function googleReadAll() {
  return ensureGoogleSheet().then(function () {
    var range = encodeURIComponent(CONFIG.GOOGLE_TAB + '!A2:H');
    return sheetsApi('values/' + range).then(function (res) {
      var rows = (res && res.values) ? res.values : [];
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || r.length < 6) continue;
        out.push({ id: String(r[0] || ''), date: String(r[1] || ''), intitule: String(r[2] || ''), montant: Number(r[3]) || 0, type: String(r[4] || ''), categorie: String(r[5] || ''), note: String(r[6] || ''), timestamp: String(r[7] || '') });
      }
      return out;
    });
  });
}

function googleAppendOne(t) {
  return ensureGoogleSheet().then(function () {
    var range = encodeURIComponent(CONFIG.GOOGLE_TAB + '!A:H');
    var row = [[t.id, t.date, t.intitule, t.montant, t.type, t.categorie, t.note || '', t.timestamp || new Date().toISOString()]];
    return sheetsApi('values/' + range + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: row }) });
  });
}

function googleWriteAll(list) {
  return ensureGoogleSheet().then(function () {
    var range = encodeURIComponent(CONFIG.GOOGLE_TAB + '!A2:H');
    return sheetsApi('values/' + range + ':clear', { method: 'POST', body: '{}' }).then(function () {
      if (!list.length) return;
      var values = [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i]; values.push([t.id, t.date, t.intitule, t.montant, t.type, t.categorie, t.note || '', t.timestamp || '']);
      }
      return sheetsApi('values/' + range + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ range: CONFIG.GOOGLE_TAB + '!A2:H', majorDimension: 'ROWS', values: values }) });
    });
  });
}

function connectGoogleSheet() {
  var sid = extractSheetId((($('googleSheetUrlModal') || {}).value) || '');
  if (!sid) { showToast('error', 'Lien Google Sheet invalide.'); return; }
  state.google.sheetId = sid; saveGoogleSheetId(sid);

  ensureGoogleToken(true).then(function () { return googleReadAll(); }).then(function (remote) {
    state.transactions = mergeTransactions(state.transactions, remote);
    state.google.connected = true;
    saveTransactions(); updateTxnBadge(); refreshDashboard();
    if ($('view-history').classList.contains('active')) refreshHistory();
    if ($('view-analytics').classList.contains('active')) refreshAnalytics();
    closeGoogleModal(); updateGoogleUiState(); showToast('success', 'Google connecte et synchronise.');
  }).catch(function (e) {
    state.google.connected = false; updateGoogleUiState(); showToast('error', 'Connexion Google impossible: ' + e.message);
  });
}

function manualSyncGoogle() {
  if (!state.google.connected || !state.google.sheetId) { showToast('error', 'Aucune feuille Google connectee.'); return; }
  googleReadAll().then(function (remote) {
    var merged = mergeTransactions(state.transactions, remote);
    return googleWriteAll(merged).then(function () {
      state.transactions = merged;
      saveTransactions(); updateTxnBadge(); refreshDashboard();
      if ($('view-history').classList.contains('active')) refreshHistory();
      if ($('view-analytics').classList.contains('active')) refreshAnalytics();
      showToast('success', 'Synchronisation Google terminee.');
    });
  }).catch(function (e) { showToast('error', 'Erreur Google: ' + e.message); });
}

function disconnectGoogle() {
  state.google.connected = false; state.google.sheetId = ''; state.google.token = '';
  saveGoogleSheetId(''); updateGoogleUiState(); showToast('success', 'Google deconnecte.');
}

function initGoogle() {
  state.google.enabled = !!CONFIG.GOOGLE_CLIENT_ID;
  var saved = loadGoogleSheetId();
  if (saved) { state.google.sheetId = saved; state.google.connected = state.google.enabled; }

  if ($('googleConnectBtn')) $('googleConnectBtn').addEventListener('click', openGoogleModal);
  if ($('googleSyncBtn')) $('googleSyncBtn').addEventListener('click', manualSyncGoogle);
  if ($('googleDisconnectBtn')) $('googleDisconnectBtn').addEventListener('click', disconnectGoogle);
  if ($('googleModalConfirm')) $('googleModalConfirm').addEventListener('click', connectGoogleSheet);
  if ($('googleModalCancel')) $('googleModalCancel').addEventListener('click', closeGoogleModal);
  if ($('googleModalClose')) $('googleModalClose').addEventListener('click', closeGoogleModal);
  if ($('googleSheetUrlModal')) $('googleSheetUrlModal').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); connectGoogleSheet(); } });
  if ($('googleModalBackdrop')) $('googleModalBackdrop').addEventListener('click', function (e) { if (e.target && e.target.id === 'googleModalBackdrop') closeGoogleModal(); });

  updateGoogleUiState();
}

function getMonthTransactions() {
  var key = state.currentYear + '-' + String(state.currentMonth + 1).padStart(2, '0');
  var out = [];
  for (var i = 0; i < state.transactions.length; i++) if (monthKey(state.transactions[i].date) === key) out.push(state.transactions[i]);
  return out;
}

function destroyChart(name) {
  if (state.charts[name] && typeof state.charts[name].destroy === 'function') state.charts[name].destroy();
  state.charts[name] = null;
}

function renderRecentTxns(list) {
  var c = $('recentTxns'); if (!c) return;
  if (!list.length) { c.innerHTML = '<p class="tx-meta">Aucune operation ce mois.</p>'; return; }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i]; var dep = t.type === 'Depense';
    html += '<div class="tx-item"><div><div><strong>' + escHtml(t.intitule) + '</strong></div><div class="tx-meta">' + escHtml(fmtDate(t.date)) + ' - ' + escHtml(t.categorie) + '</div></div>';
    html += '<div class="' + (dep ? 'amount-red' : 'amount-green') + '">' + (dep ? '- ' : '+ ') + fmtAmount(t.montant) + '</div></div>';
  }
  c.innerHTML = html;
}
function renderDonutChart(list) {
  var pct = $('donutPct'); var legend = $('donutLegend'); var canvas = $('donutChart');
  if (!pct || !legend || !canvas) return;

  var income = 0, expense = 0, byCat = {};
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (t.type === 'Recette') income += Number(t.montant) || 0;
    if (t.type === 'Depense') {
      expense += Number(t.montant) || 0;
      if (!byCat[t.categorie]) byCat[t.categorie] = 0;
      byCat[t.categorie] += Number(t.montant) || 0;
    }
  }

  var saved = Math.max(0, income - expense);
  var rate = income > 0 ? Math.round((saved / income) * 100) : 0;
  pct.textContent = rate + '%';

  var rows = [];
  for (var k in byCat) if (Object.prototype.hasOwnProperty.call(byCat, k)) rows.push([k, byCat[k]]);
  rows.sort(function (a, b) { return b[1] - a[1]; });
  rows = rows.slice(0, 5);
  if (saved > 0) rows.push(['Epargne', saved]);

  destroyChart('donut');
  if (!rows.length) { legend.innerHTML = '<small class="tx-meta">Aucune donnee.</small>'; return; }

  var html = '';
  for (var j = 0; j < rows.length; j++) {
    html += '<div class="legend-item"><span class="legend-dot" style="background:' + CONFIG.CHART_COLORS[j % CONFIG.CHART_COLORS.length] + '"></span>';
    html += '<span>' + escHtml(rows[j][0]) + '</span><span class="legend-val">' + fmtAmount(rows[j][1]) + '</span></div>';
  }
  legend.innerHTML = html;

  if (!hasChart()) return;
  state.charts.donut = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels: rows.map(function (r) { return r[0]; }), datasets: [{ data: rows.map(function (r) { return r[1]; }), backgroundColor: rows.map(function (_r, i) { return CONFIG.CHART_COLORS[i % CONFIG.CHART_COLORS.length]; }), borderColor: '#161f39', borderWidth: 2 }] },
    options: { cutout: '72%', plugins: { legend: { display: false } } }
  });
}

function renderBarChart() {
  var canvas = $('barChart'); if (!canvas || !hasChart()) return;
  var months = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(state.currentYear, state.currentMonth - i, 1);
    months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('fr-FR', { month: 'short' }) });
  }

  var inc = [], exp = [];
  for (var m = 0; m < months.length; m++) {
    var a = 0, b = 0;
    for (var t = 0; t < state.transactions.length; t++) {
      var tx = state.transactions[t];
      if (monthKey(tx.date) !== months[m].key) continue;
      if (tx.type === 'Recette') a += Number(tx.montant) || 0;
      if (tx.type === 'Depense') b += Number(tx.montant) || 0;
    }
    inc.push(a); exp.push(b);
  }

  destroyChart('bar');
  state.charts.bar = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: months.map(function (x) { return x.label; }), datasets: [{ label: 'Income', data: inc, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 6 }, { label: 'Spend', data: exp, backgroundColor: 'rgba(76,111,255,0.72)', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function refreshMovedCharts() {
  var monthTx = getMonthTransactions();
  renderDonutChart(monthTx);
  renderBarChart();
}

function refreshDashboard() {
  var list = getMonthTransactions();
  var income = 0, expense = 0, ic = 0, ec = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i].type === 'Recette') { income += Number(list[i].montant) || 0; ic++; }
    if (list[i].type === 'Depense') { expense += Number(list[i].montant) || 0; ec++; }
  }
  var balance = income - expense;
  var rate = income > 0 ? Math.max(0, Math.min(100, Math.round((balance / income) * 100))) : 0;

  if ($('kpiBalance')) $('kpiBalance').textContent = (balance >= 0 ? '+ ' : '- ') + fmtAmount(Math.abs(balance));
  if ($('kpiIncome')) $('kpiIncome').textContent = fmtAmount(income);
  if ($('kpiExpense')) $('kpiExpense').textContent = fmtAmount(expense);
  if ($('kpiIncomeCount')) $('kpiIncomeCount').textContent = ic + ' operation(s)';
  if ($('kpiExpenseCount')) $('kpiExpenseCount').textContent = ec + ' operation(s)';
  if ($('kpiBalanceTrend')) $('kpiBalanceTrend').textContent = income > 0 ? ('Taux epargne: ' + rate + '%') : 'Aucune recette ce mois';
  if ($('kpiBalanceFill')) $('kpiBalanceFill').style.width = rate + '%';

  renderRecentTxns(list.slice(0, 6));
}

function initHistory() {
  var ids = ['filterSearch', 'filterType', 'filterCat', 'filterMonth'];
  for (var i = 0; i < ids.length; i++) {
    var el = $(ids[i]); if (!el) continue;
    el.addEventListener('input', applyFilters);
    el.addEventListener('change', applyFilters);
  }

  var cols = bySelAll('.tx-table th.sortable');
  for (var c = 0; c < cols.length; c++) {
    cols[c].addEventListener('click', function () {
      var f = this.getAttribute('data-sort');
      if (state.sortField === f) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortField = f; state.sortDir = 'desc'; }
      applyFilters();
    });
  }
}

function refreshHistory() {
  if (!$('filterMonth') || !$('filterCat')) return;
  var monthSel = $('filterMonth');
  var catSel = $('filterCat');
  var monthKeep = monthSel.value;

  monthSel.innerHTML = '<option value="">Tous les mois</option>';
  catSel.innerHTML = '<option value="">Toutes categories</option>';

  var months = {}, cats = {};
  for (var i = 0; i < state.transactions.length; i++) {
    var t = state.transactions[i];
    var mk = monthKey(t.date);
    if (mk) months[mk] = true;
    if (t.categorie) cats[t.categorie] = true;
  }

  var listM = Object.keys(months).sort().reverse();
  for (var m = 0; m < listM.length; m++) {
    var p = listM[m].split('-');
    var o = document.createElement('option');
    o.value = listM[m];
    o.textContent = new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    monthSel.appendChild(o);
  }

  var listC = Object.keys(cats).sort();
  for (var c = 0; c < listC.length; c++) {
    var oc = document.createElement('option');
    oc.value = listC[c];
    oc.textContent = listC[c];
    catSel.appendChild(oc);
  }

  monthSel.value = monthKeep;
  applyFilters();
}

function applyFilters() {
  var q = String((($('filterSearch') || {}).value) || '').toLowerCase().trim();
  var type = String((($('filterType') || {}).value) || '');
  var cat = String((($('filterCat') || {}).value) || '');
  var month = String((($('filterMonth') || {}).value) || '');

  var out = [];
  for (var i = 0; i < state.transactions.length; i++) {
    var t = state.transactions[i];
    var ok = true;
    if (q) {
      var hay = (t.intitule + ' ' + (t.note || '') + ' ' + t.categorie).toLowerCase();
      if (hay.indexOf(q) === -1) ok = false;
    }
    if (ok && type && t.type !== type) ok = false;
    if (ok && cat && t.categorie !== cat) ok = false;
    if (ok && month && monthKey(t.date) !== month) ok = false;
    if (ok) out.push(t);
  }

  out.sort(function (a, b) {
    var va = state.sortField === 'montant' ? Number(a.montant) || 0 : a[state.sortField];
    var vb = state.sortField === 'montant' ? Number(b.montant) || 0 : b[state.sortField];
    if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  var income = 0, expense = 0;
  for (var x = 0; x < out.length; x++) {
    if (out[x].type === 'Recette') income += Number(out[x].montant) || 0;
    if (out[x].type === 'Depense') expense += Number(out[x].montant) || 0;
  }

  if ($('filterResultCount')) $('filterResultCount').textContent = out.length + ' resultat(s)';
  if ($('filterIncomeSum')) $('filterIncomeSum').textContent = 'Recettes: ' + fmtAmount(income);
  if ($('filterExpenseSum')) $('filterExpenseSum').textContent = 'Depenses: ' + fmtAmount(expense);
  if ($('filterBalance')) $('filterBalance').textContent = 'Solde: ' + ((income - expense) >= 0 ? '+ ' : '- ') + fmtAmount(Math.abs(income - expense));

  var body = $('txnTableBody');
  if (!body) return;
  if (!out.length) { body.innerHTML = '<tr><td colspan="5" class="tx-meta">Aucun resultat.</td></tr>'; return; }

  var html = '';
  for (var r = 0; r < out.length; r++) {
    var t2 = out[r], dep = t2.type === 'Depense';
    html += '<tr><td>' + escHtml(fmtDate(t2.date)) + '</td><td><strong>' + escHtml(t2.intitule) + '</strong>' + (t2.note ? '<div class="tx-meta">' + escHtml(t2.note) + '</div>' : '') + '</td><td>' + escHtml(t2.categorie) + '</td><td>' + escHtml(t2.type) + '</td><td class="right ' + (dep ? 'amount-red' : 'amount-green') + '">' + (dep ? '- ' : '+ ') + fmtAmount(t2.montant) + '</td></tr>';
  }
  body.innerHTML = html;
}
function renderLineChart() {
  var canvas = $('lineChart');
  if (!canvas || !hasChart()) return;

  var months = [];
  for (var i = 11; i >= 0; i--) {
    var d = new Date(state.currentYear, state.currentMonth - i, 1);
    months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) });
  }

  var inc = [], exp = [];
  for (var m = 0; m < months.length; m++) {
    var a = 0, b = 0;
    for (var t = 0; t < state.transactions.length; t++) {
      var tx = state.transactions[t];
      if (monthKey(tx.date) !== months[m].key) continue;
      if (tx.type === 'Recette') a += Number(tx.montant) || 0;
      if (tx.type === 'Depense') b += Number(tx.montant) || 0;
    }
    inc.push(a); exp.push(b);
  }

  destroyChart('line');
  state.charts.line = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: months.map(function (x) { return x.label; }), datasets: [{ label: 'Income', data: inc, backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 6 }, { label: 'Spend', data: exp, backgroundColor: 'rgba(76,111,255,0.65)', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function refreshAnalytics() {
  refreshMovedCharts();

  var tx = state.transactions;
  var income = 0, expense = 0, expMap = {}, incMap = {};

  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    if (t.type === 'Recette') {
      income += Number(t.montant) || 0;
      if (!incMap[t.categorie]) incMap[t.categorie] = 0;
      incMap[t.categorie] += Number(t.montant) || 0;
    }
    if (t.type === 'Depense') {
      expense += Number(t.montant) || 0;
      if (!expMap[t.categorie]) expMap[t.categorie] = 0;
      expMap[t.categorie] += Number(t.montant) || 0;
    }
  }

  var saved = Math.max(0, income - expense);
  var rate = income > 0 ? Math.round((saved / income) * 100) : 0;
  if ($('savingsRate')) $('savingsRate').textContent = rate + '%';

  if ($('savingsBreakdown')) {
    $('savingsBreakdown').innerHTML = '<p>Recettes: <strong class="amount-green">' + fmtAmount(income) + '</strong></p>' +
      '<p>Depenses: <strong class="amount-red">' + fmtAmount(expense) + '</strong></p>' +
      '<p>Epargne nette: <strong>' + fmtAmount(saved) + '</strong></p>' +
      '<p>Transactions: <strong>' + tx.length + '</strong></p>';
  }

  if (hasChart() && $('savingsChart')) {
    destroyChart('savings');
    state.charts.savings = new Chart($('savingsChart').getContext('2d'), {
      type: 'doughnut',
      data: { datasets: [{ data: [saved || 0.001, expense || 0.001], backgroundColor: ['#4C6FFF', 'rgba(255,255,255,0.07)'], borderWidth: 0 }] },
      options: { cutout: '82%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
  }

  function topHtml(mapObj, isExpense) {
    var arr = [];
    for (var k in mapObj) if (Object.prototype.hasOwnProperty.call(mapObj, k)) arr.push([k, mapObj[k]]);
    arr.sort(function (a, b) { return b[1] - a[1]; });
    arr = arr.slice(0, 5);
    var max = arr.length ? arr[0][1] : 1;
    if (!arr.length) return '<p class="tx-meta">Aucune donnee.</p>';
    var html = '';
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i][1];
      var w = Math.max(5, Math.round((v / max) * 100));
      html += '<div class="top-row"><span>' + escHtml(arr[i][0]) + '</span><strong class="' + (isExpense ? 'amount-red' : 'amount-green') + '">' + (isExpense ? '- ' : '+ ') + fmtAmount(v) + '</strong><div class="top-bar"><div style="width:' + w + '%;background:' + (isExpense ? '#ff4d6a' : '#00d68f') + '"></div></div></div>';
    }
    return html;
  }

  if ($('topExpenses')) $('topExpenses').innerHTML = topHtml(expMap, true);
  if ($('topIncomes')) $('topIncomes').innerHTML = topHtml(incMap, false);
  renderLineChart();
}

function exportCSV() {
  var rows = [['Date', 'Intitule', 'Categorie', 'Type', 'Montant', 'Note']];
  for (var i = 0; i < state.transactions.length; i++) {
    var t = state.transactions[i];
    rows.push([t.date, t.intitule, t.categorie, t.type, t.montant, t.note || '']);
  }

  var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'flux-export-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function initExport() { if ($('exportBtn')) $('exportBtn').addEventListener('click', exportCSV); }

function seedDemoData() {
  if (state.transactions.length) return;
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  state.transactions = [
    { id: 'd1', date: y + '-' + m + '-01', intitule: 'Salaire', montant: 300000, type: 'Recette', categorie: 'Salaire', note: '', timestamp: new Date().toISOString() },
    { id: 'd2', date: y + '-' + m + '-03', intitule: 'Loyer', montant: 90000, type: 'Depense', categorie: 'Logement', note: '', timestamp: new Date().toISOString() },
    { id: 'd3', date: y + '-' + m + '-05', intitule: 'Courses', montant: 28000, type: 'Depense', categorie: 'Alimentation', note: '', timestamp: new Date().toISOString() }
  ];
  saveTransactions();
}

function handleSubmit() {
  if (!validateForm()) { showToast('error', 'Veuillez remplir tous les champs obligatoires.'); return; }

  setLoading(true);
  var tx = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    date: $('fieldDate').value,
    intitule: $('fieldIntitule').value.trim(),
    montant: Number($('fieldMontant').value),
    type: state.currentType,
    categorie: $('fieldCategorie').value,
    note: $('fieldNote').value.trim(),
    timestamp: new Date().toISOString()
  };

  state.transactions.unshift(tx);
  saveTransactions();
  updateTxnBadge();
  refreshDashboard();

  var cloudP = cloudPushOne(tx);
  var googleP = (state.google.connected && state.google.sheetId) ? googleAppendOne(tx).then(function () { return true; }).catch(function () { return false; }) : Promise.resolve(false);

  Promise.all([cloudP, googleP]).then(function (res) {
    setLoading(false);
    var cloudOk = res[0], googleOk = res[1];
    if (cloudOk && googleOk) showToast('success', 'Operation synchronisee cloud et Google.');
    else if (cloudOk) showToast('success', 'Operation synchronisee cloud.');
    else if (googleOk) showToast('success', 'Operation synchronisee Google.');
    else showToast('success', 'Operation enregistree localement.');
    setTimeout(resetForm, 1000);
  });
}

function initForm() {
  if ($('btnDepense')) $('btnDepense').addEventListener('click', function () { setType('Depense'); });
  if ($('btnRecette')) $('btnRecette').addEventListener('click', function () { setType('Recette'); });
  if ($('fieldDate')) $('fieldDate').value = new Date().toISOString().slice(0, 10);
  if ($('fieldIntitule')) $('fieldIntitule').addEventListener('input', function () { if ($('charCount')) $('charCount').textContent = String(this.value.length); });
  if ($('btnReset')) $('btnReset').addEventListener('click', resetForm);
  if ($('btnSubmit')) $('btnSubmit').addEventListener('click', handleSubmit);
  setType('Depense');
}

function installGuards() {
  window.addEventListener('error', function (evt) { console.error('[Flux] JS error:', evt.message); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeAuthModal(); closeGoogleModal(); closeSidebar(); }
  });
}

function init() {
  installGuards();
  loadTransactions();
  if (CONFIG.ENABLE_DEMO_DATA) seedDemoData();

  initNavigation();
  initForm();
  initHistory();
  initExport();
  initCloud();
  initGoogle();

  updateMonthLabel();
  updateTxnBadge();
  refreshDashboard();
}

document.addEventListener('DOMContentLoaded', init);

