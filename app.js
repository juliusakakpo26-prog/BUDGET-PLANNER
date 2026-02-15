/* =============================================
   FLUX â€” Dark Theme App Logic (app.js)
   ============================================= */

'use strict';

const RUNTIME_CONFIG = (typeof window !== 'undefined' && window.FLUX_CONFIG) ? window.FLUX_CONFIG : {};

const CONFIG = {
  SUPABASE_URL: RUNTIME_CONFIG.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: RUNTIME_CONFIG.SUPABASE_ANON_KEY || '',
  SUPABASE_TABLE: 'transactions',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  SHEET_TAB_NAME: 'Transactions',
  SHEET_HEADERS: ['ID', 'Date', 'Intitule', 'Montant', 'Type', 'Categorie', 'Note', 'Timestamp'],
  ENABLE_DEMO_DATA: true,

  CATEGORIES: {
    DÃ©pense: [
      { value: 'Alimentation', icon: 'ðŸ›’' },
      { value: 'Logement', icon: 'ðŸ ' },
      { value: 'Transport', icon: 'ðŸšŒ' },
      { value: 'SantÃ©', icon: 'ðŸ¥' },
      { value: 'Ã‰ducation', icon: 'ðŸ“š' },
      { value: 'Loisirs', icon: 'ðŸŽ­' },
      { value: 'VÃªtements', icon: 'ðŸ‘•' },
      { value: 'Communication', icon: 'ðŸ“±' },
      { value: 'Ã‰pargne', icon: 'ðŸ¦' },
      { value: 'Autre dÃ©pense', icon: 'ðŸ“¦' },
    ],
    Recette: [
      { value: 'Salaire', icon: 'ðŸ’¼' },
      { value: 'Freelance', icon: 'ðŸ’»' },
      { value: 'Commerce', icon: 'ðŸª' },
      { value: 'Agriculture', icon: 'ðŸŒ¾' },
      { value: 'Transfert reÃ§u', icon: 'ðŸ“©' },
      { value: 'Investissement', icon: 'ðŸ“ˆ' },
      { value: 'Aide/Subvention', icon: 'ðŸ¤' },
      { value: 'Autre recette', icon: 'ðŸ’°' },
    ],
  },

  // Dark theme chart colors matching reference image
  CHART_COLORS: ['#4C6FFF', '#00D68F', '#FF4D6A', '#FFB830', '#9B59FF', '#14B8A6', '#F97316', '#EC4899', '#3B82F6', '#6B7280'],
};

// ============ STATE ============
const state = {
  transactions: [],
  currentType: 'DÃ©pense',
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  sortField: 'date',
  sortDir: 'desc',
  filters: { search: '', type: '', category: '', month: '' },
  charts: { donut: null, bar: null, line: null, savings: null },
  google: {
    tokenClient: null,
    accessToken: '',
    sheetId: '',
    connected: false,
  },
  cloud: {
    client: null,
    enabled: false,
    user: null,
  },
};

// ============ UTILS ============
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.abs(Math.round(n))) + ' FCFA';
const fmtDate = (iso) => {
  if (!iso) return 'â€”';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const monthKey = (iso) => iso ? iso.substring(0, 7) : '';
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

function getCatIcon(catName, type) {
  const list = CONFIG.CATEGORIES[type] || [...CONFIG.CATEGORIES.DÃ©pense, ...CONFIG.CATEGORIES.Recette];
  const found = list.find(c => c.value === catName);
  return found ? found.icon : (type === 'Recette' ? 'ðŸ’°' : 'ðŸ“¦');
}

// ============ LOCAL STORAGE ============
function saveTransactions() {
  try { localStorage.setItem('flux_transactions', JSON.stringify(state.transactions)); } catch(e) {}
}
function loadTransactions() {
  try {
    const data = localStorage.getItem('flux_transactions');
    if (data) state.transactions = JSON.parse(data);
  } catch(e) { state.transactions = []; }
}

function saveGoogleSheetId(id) {
  try { localStorage.setItem('flux_google_sheet_id', id || ''); } catch(e) {}
}
function loadGoogleSheetId() {
  try { return localStorage.getItem('flux_google_sheet_id') || ''; } catch(e) { return ''; }
}

// ============ SUPABASE CLOUD SYNC ============
function cloudConfigured() {
  return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined' && window.supabase.createClient);
}

function updateCloudStatus(msg) {
  const el = $('cloudStatus');
  if (el) el.textContent = msg;
}

function updateCloudUiState() {
  const accountBtn = $('accountBtn');
  const cloudSyncBtn = $('cloudSyncBtn');
  const authUserLabel = $('authUserLabel');
  const loggedIn = !!(state.cloud.enabled && state.cloud.user);

  if (!state.cloud.enabled) {
    if (accountBtn) {
      accountBtn.disabled = true;
      accountBtn.textContent = 'Compte (non configuré)';
    }
    if (cloudSyncBtn) cloudSyncBtn.disabled = true;
    updateCloudStatus('Cloud: non configuré');
    if (authUserLabel) authUserLabel.textContent = 'Supabase non configuré';
    return;
  }

  if (accountBtn) {
    accountBtn.disabled = false;
    accountBtn.textContent = loggedIn ? 'Compte connecté' : 'Compte';
  }
  if (cloudSyncBtn) cloudSyncBtn.disabled = !loggedIn;
  if (authUserLabel) authUserLabel.textContent = loggedIn ? state.cloud.user.email : 'Non connecté';
  updateCloudStatus(loggedIn ? `Cloud: connecté (${state.cloud.user.email})` : 'Cloud: prêt (connexion requise)');
}

function openAuthModal() {
  const backdrop = $('authModalBackdrop');
  if (!backdrop) return;
  backdrop.classList.remove('hidden');
  const email = $('authEmail');
  if (email) setTimeout(() => email.focus(), 10);
}

function closeAuthModal() {
  const backdrop = $('authModalBackdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

function mapToCloudRow(t) {
  return {
    id: t.id,
    user_id: state.cloud.user.id,
    date: t.date,
    intitule: t.intitule,
    montant: t.montant,
    type: t.type,
    categorie: t.categorie,
    note: t.note || '',
    timestamp: t.timestamp || new Date().toISOString(),
  };
}

function mapFromCloudRow(row) {
  return {
    id: String(row.id),
    date: String(row.date),
    intitule: String(row.intitule),
    montant: parseFloat(row.montant) || 0,
    type: String(row.type),
    categorie: String(row.categorie),
    note: String(row.note || ''),
    timestamp: String(row.timestamp || ''),
  };
}

async function cloudPullTransactions() {
  const { data, error } = await state.cloud.client
    .from(CONFIG.SUPABASE_TABLE)
    .select('id,date,intitule,montant,type,categorie,note,timestamp')
    .eq('user_id', state.cloud.user.id);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFromCloudRow);
}

async function cloudPushTransactions(transactions) {
  if (!transactions.length) return;
  const payload = transactions.map(mapToCloudRow);
  const { error } = await state.cloud.client
    .from(CONFIG.SUPABASE_TABLE)
    .upsert(payload, { onConflict: 'user_id,id' });
  if (error) throw new Error(error.message);
}

async function cloudSyncAll() {
  if (!state.cloud.enabled || !state.cloud.user) {
    showToast('error', 'Connexion cloud requise.');
    return;
  }
  try {
    const remote = await cloudPullTransactions();
    const merged = mergeTransactions(state.transactions, remote);
    await cloudPushTransactions(merged);
    state.transactions = merged;
    saveTransactions();
    updateTxnBadge();
    refreshDashboard();
    if (document.getElementById('view-history').classList.contains('active')) refreshHistory();
    if (document.getElementById('view-analytics').classList.contains('active')) refreshAnalytics();
    showToast('success', 'Synchronisation cloud terminee.');
  } catch (e) {
    showToast('error', `Erreur cloud: ${e.message}`);
  }
}

async function cloudPushOne(transaction) {
  if (!state.cloud.enabled || !state.cloud.user) return;
  try {
    await cloudPushTransactions([transaction]);
  } catch (e) {
    // Keep local-first behavior if cloud upsert fails.
  }
}

async function authSignup() {
  if (!state.cloud.enabled) return;
  const email = (($('authEmail') || {}).value || '').trim();
  const password = (($('authPassword') || {}).value || '').trim();
  if (!email || password.length < 6) {
    showToast('error', 'Email et mot de passe (min 6) requis.');
    return;
  }
  const { error } = await state.cloud.client.auth.signUp({ email, password });
  if (error) {
    showToast('error', `Inscription: ${error.message}`);
    return;
  }
  showToast('success', 'Inscription faite. Verifiez votre email si confirmation activee.');
}

async function authLogin() {
  if (!state.cloud.enabled) return;
  const email = (($('authEmail') || {}).value || '').trim();
  const password = (($('authPassword') || {}).value || '').trim();
  if (!email || !password) {
    showToast('error', 'Email et mot de passe requis.');
    return;
  }
  const { data, error } = await state.cloud.client.auth.signInWithPassword({ email, password });
  if (error) {
    showToast('error', `Connexion: ${error.message}`);
    return;
  }
  state.cloud.user = data.user || null;
  updateCloudUiState();
  await cloudSyncAll();
  closeAuthModal();
}

async function authLogout() {
  if (!state.cloud.enabled) return;
  await state.cloud.client.auth.signOut();
  state.cloud.user = null;
  updateCloudUiState();
  showToast('success', 'Compte deconnecte.');
}

async function initCloud() {
  if (!cloudConfigured()) {
    state.cloud.enabled = false;
    updateCloudUiState();
    return;
  }
  
  try {
    state.cloud.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    state.cloud.enabled = true;

    const { data } = await state.cloud.client.auth.getSession();
    state.cloud.user = data && data.session ? data.session.user : null;

    state.cloud.client.auth.onAuthStateChange((_event, session) => {
      state.cloud.user = session ? session.user : null;
      updateCloudUiState();
    });

    $('accountBtn')?.addEventListener('click', openAuthModal);
    $('cloudSyncBtn')?.addEventListener('click', cloudSyncAll);
    $('authModalClose')?.addEventListener('click', closeAuthModal);
    $('authSignupBtn')?.addEventListener('click', authSignup);
    $('authLoginBtn')?.addEventListener('click', authLogin);
    $('authLogoutBtn')?.addEventListener('click', authLogout);
    $('authEmail')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); authLogin(); }
    });
    $('authPassword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); authLogin(); }
    });
    $('authModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'authModalBackdrop') closeAuthModal();
    });
    updateCloudUiState();

    if (state.cloud.user) await cloudSyncAll();
  } catch (error) {
    console.warn('Erreur d\'initialisation Supabase:', error);
    state.cloud.enabled = false;
    updateCloudUiState();
  }
}

// ============ GOOGLE SHEETS API ============
function extractSpreadsheetId(input) {
  const val = (input || '').trim();
  if (!val) return '';
  const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(val)) return val;
  return '';
}

function mapTransactionToRow(t) {
  return [t.id, t.date, t.intitule, t.montant, t.type, t.categorie, t.note || '', t.timestamp || new Date().toISOString()];
}

function mapRowToTransaction(row) {
  if (!row || row.length < 6) return null;
  const montant = parseFloat(row[3]);
  if (!row[0] || !row[1] || !row[2] || !Number.isFinite(montant) || !row[4] || !row[5]) return null;
  return {
    id: String(row[0]),
    date: String(row[1]),
    intitule: String(row[2]),
    montant,
    type: String(row[4]),
    categorie: String(row[5]),
    note: String(row[6] || ''),
    timestamp: String(row[7] || ''),
  };
}

function mergeTransactions(localTxns, remoteTxns) {
  const byId = new Map();
  [...localTxns, ...remoteTxns].forEach((t) => {
    if (!t || !t.id) return;
    const current = byId.get(t.id);
    if (!current) {
      byId.set(t.id, t);
      return;
    }
    const curTs = Date.parse(current.timestamp || '') || 0;
    const nextTs = Date.parse(t.timestamp || '') || 0;
    byId.set(t.id, nextTs >= curTs ? t : current);
  });
  return Array.from(byId.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function ensureGoogleIdentityReady() {
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    throw new Error('Google Identity Service non charge');
  }
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID manquant dans app.js');
  }
  if (!state.google.tokenClient) {
    state.google.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_SCOPES,
      callback: () => {},
    });
  }
}

async function requestGoogleAccessToken(interactive) {
  await ensureGoogleIdentityReady();
  return new Promise((resolve, reject) => {
    state.google.tokenClient.callback = (resp) => {
      if (resp && resp.access_token) {
        state.google.accessToken = resp.access_token;
        resolve(resp.access_token);
      } else if (resp && resp.error) {
        reject(new Error(resp.error_description || resp.error));
      } else {
        reject(new Error('Echec OAuth Google'));
      }
    };
    state.google.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function ensureAccessToken(interactive) {
  if (state.google.accessToken) return state.google.accessToken;
  return requestGoogleAccessToken(interactive);
}

async function sheetsApi(path, options) {
  const token = await ensureAccessToken(false);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.google.sheetId}/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });
  if (response.status === 401) {
    state.google.accessToken = '';
    const refreshToken = await ensureAccessToken(true);
    const retry = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
    });
    if (!retry.ok) throw new Error(`Sheets API error ${retry.status}`);
    if (retry.status === 204) return null;
    return retry.json();
  }
  if (!response.ok) throw new Error(`Sheets API error ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function ensureSheetTabExists() {
  const meta = await sheetsApi('?fields=sheets.properties.title');
  const sheets = meta && meta.sheets ? meta.sheets : [];
  const exists = sheets.some((s) => s && s.properties && s.properties.title === CONFIG.SHEET_TAB_NAME);
  if (exists) return;
  await sheetsApi(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: CONFIG.SHEET_TAB_NAME } } }],
    }),
  });
}

async function ensureSheetInitialized() {
  await ensureSheetTabExists();
  const encoded = encodeURIComponent(`${CONFIG.SHEET_TAB_NAME}!A1:H1`);
  const current = await sheetsApi(`values/${encoded}`);
  const currentValues = current && current.values && current.values[0] ? current.values[0] : [];
  if (currentValues.join('|') === CONFIG.SHEET_HEADERS.join('|')) return;
  await sheetsApi(`values/${encoded}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({
      range: `${CONFIG.SHEET_TAB_NAME}!A1:H1`,
      majorDimension: 'ROWS',
      values: [CONFIG.SHEET_HEADERS],
    }),
  });
}

async function readTransactionsFromGoogle() {
  await ensureSheetInitialized();
  const encoded = encodeURIComponent(`${CONFIG.SHEET_TAB_NAME}!A2:H`);
  const result = await sheetsApi(`values/${encoded}`);
  const rows = result && result.values ? result.values : [];
  return rows.map(mapRowToTransaction).filter(Boolean);
}

async function appendTransactionToGoogle(transaction) {
  await ensureSheetInitialized();
  const encoded = encodeURIComponent(`${CONFIG.SHEET_TAB_NAME}!A:H`);
  await sheetsApi(`values/${encoded}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [mapTransactionToRow(transaction)] }),
  });
  return { ok: true };
}

async function writeAllTransactionsToGoogle(transactions) {
  await ensureSheetInitialized();
  const clearRange = encodeURIComponent(`${CONFIG.SHEET_TAB_NAME}!A2:H`);
  await sheetsApi(`values/${clearRange}:clear`, { method: 'POST', body: '{}' });
  const rows = transactions.map(mapTransactionToRow);
  if (!rows.length) return { ok: true };
  await sheetsApi(`values/${clearRange}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({
      range: `${CONFIG.SHEET_TAB_NAME}!A2:H`,
      majorDimension: 'ROWS',
      values: rows,
    }),
  });
  return { ok: true };
}

function updateGoogleStatus(msg) {
  const el = $('googleStatus');
  if (el) el.textContent = msg;
}

function updateGoogleUiState() {
  const connected = !!(state.google.connected && state.google.sheetId);
  const connectBtn = $('googleConnectBtn');
  const syncBtn = $('googleSyncBtn');
  const disconnectBtn = $('googleDisconnectBtn');
  if (connectBtn) connectBtn.textContent = connected ? 'Reconnect Google' : 'Connect Google';
  if (syncBtn) syncBtn.disabled = !connected;
  if (disconnectBtn) disconnectBtn.disabled = !connected;
  updateGoogleStatus(connected ? `Google: connecte (${state.google.sheetId})` : 'Google: non connecte');
}

function openGoogleModal() {
  const backdrop = $('googleModalBackdrop');
  const input = $('googleSheetUrlModal');
  if (!backdrop || !input) return;
  input.value = state.google.sheetId || '';
  backdrop.classList.remove('hidden');
  setTimeout(() => input.focus(), 10);
}

function closeGoogleModal() {
  const backdrop = $('googleModalBackdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

async function connectGoogleSheet(rawValue) {
  const sheetId = extractSpreadsheetId(rawValue || '');
  if (!sheetId) {
    showToast('error', 'Lien Google Sheet invalide.');
    return;
  }
  state.google.sheetId = sheetId;
  saveGoogleSheetId(sheetId);
  try {
    await requestGoogleAccessToken(true);
    const remote = await readTransactionsFromGoogle();
    state.transactions = mergeTransactions(state.transactions, remote);
    state.google.connected = true;
    saveTransactions();
    updateTxnBadge();
    refreshDashboard();
    if (document.getElementById('view-history').classList.contains('active')) refreshHistory();
    if (document.getElementById('view-analytics').classList.contains('active')) refreshAnalytics();
    closeGoogleModal();
    showToast('success', 'Google Sheet connecte et synchronise.');
  } catch (e) {
    state.google.connected = false;
    showToast('error', `Connexion Google impossible: ${e.message}`);
  }
  updateGoogleUiState();
}

async function manualSyncGoogle() {
  if (!state.google.connected || !state.google.sheetId) {
    showToast('error', 'Aucune feuille Google connectee.');
    return;
  }
  try {
    const remote = await readTransactionsFromGoogle();
    const merged = mergeTransactions(state.transactions, remote);
    await writeAllTransactionsToGoogle(merged);
    state.transactions = merged;
    saveTransactions();
    updateTxnBadge();
    refreshDashboard();
    if (document.getElementById('view-history').classList.contains('active')) refreshHistory();
    if (document.getElementById('view-analytics').classList.contains('active')) refreshAnalytics();
    showToast('success', 'Synchronisation Google terminee.');
  } catch (e) {
    showToast('error', `Erreur de sync Google: ${e.message}`);
  }
}

function disconnectGoogleSheet() {
  state.google.accessToken = '';
  state.google.connected = false;
  state.google.sheetId = '';
  saveGoogleSheetId('');
  updateGoogleUiState();
  showToast('success', 'Google deconnecte.');
}

function initGoogle() {
  // Vérifier si Google Identity Services est disponible
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    console.warn('Google Identity Services non disponible');
    // Désactiver les éléments d'interface liés à Google
    const googleElements = [
      'googleConnectBtn', 'googleSyncBtn', 'googleDisconnectBtn',
      'googleStatus', 'googleModalBackdrop'
    ];
    googleElements.forEach(id => {
      const element = $(id);
      if (element) {
        element.style.display = 'none';
      }
    });
    return;
  }

  const savedId = loadGoogleSheetId();
  if (savedId) {
    state.google.sheetId = savedId;
    state.google.connected = true;
  }
  $('googleConnectBtn')?.addEventListener('click', openGoogleModal);
  $('googleModalConfirm')?.addEventListener('click', () => connectGoogleSheet(($('googleSheetUrlModal') || {}).value || ''));
  $('googleModalCancel')?.addEventListener('click', closeGoogleModal);
  $('googleModalClose')?.addEventListener('click', closeGoogleModal);
  $('googleSheetUrlModal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectGoogleSheet(($('googleSheetUrlModal') || {}).value || '');
    }
  });
  $('googleModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'googleModalBackdrop') closeGoogleModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGoogleModal();
  });
  $('googleSyncBtn')?.addEventListener('click', manualSyncGoogle);
  $('googleDisconnectBtn')?.addEventListener('click', disconnectGoogleSheet);
  updateGoogleUiState();
}

// ============ NAVIGATION ============
function initNavigation() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.getAttribute('data-view');
      if (view) navigateTo(view);
    });
  });

  $('mobileMenuBtn').addEventListener('click', toggleSidebar);
  $('overlay').addEventListener('click', closeSidebar);

  $('prevMonth').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    updateMonthLabel();
    refreshDashboard();
  });
  $('nextMonth').addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    updateMonthLabel();
    refreshDashboard();
  });
}

function navigateTo(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const view = document.getElementById(`view-${viewId}`);
  if (view) view.classList.add('active');

  document.querySelectorAll(`[data-view="${viewId}"]`).forEach(el => {
    if (el.classList.contains('nav-link')) el.classList.add('active');
  });

  const titles = {
    dashboard: 'Tableau de bord',
    add: 'Nouvelle opÃ©ration',
    history: 'Historique',
    analytics: 'Analytiques',
  };
  $('topbarTitle').textContent = titles[viewId] || '';

  if (viewId === 'dashboard') refreshDashboard();
  if (viewId === 'history') refreshHistory();
  if (viewId === 'analytics') refreshAnalytics();

  closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
}

function updateMonthLabel() {
  $('monthLabel').textContent = monthLabel(state.currentYear, state.currentMonth);
}

function updateTxnBadge() {
  const badge = $('txnBadge');
  if (badge) badge.textContent = state.transactions.length;
}

// ============ FORM ============
function initForm() {
  $('btnDepense').addEventListener('click', () => setType('DÃ©pense'));
  $('btnRecette').addEventListener('click', () => setType('Recette'));

  const today = new Date().toISOString().split('T')[0];
  $('fieldDate').value = today;

  $('fieldIntitule').addEventListener('input', () => {
    $('charCount').textContent = $('fieldIntitule').value.length;
  });

  $('btnReset').addEventListener('click', resetForm);
  $('btnSubmit').addEventListener('click', handleSubmit);

  setType('DÃ©pense');
}

function setType(type) {
  state.currentType = type;
  $('btnDepense').classList.toggle('active', type === 'DÃ©pense');
  $('btnRecette').classList.toggle('active', type === 'Recette');
  $('btnDepense').classList.toggle('expense-active', type === 'DÃ©pense');
  $('btnDepense').classList.toggle('income-active', false);
  $('btnRecette').classList.toggle('income-active', type === 'Recette');
  $('btnRecette').classList.toggle('expense-active', false);

  const sel = $('fieldCategorie');
  sel.innerHTML = '<option value="">â€” SÃ©lectionner â€”</option>';
  CONFIG.CATEGORIES[type].forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.value;
    opt.textContent = `${cat.icon} ${cat.value}`;
    sel.appendChild(opt);
  });
}

function resetForm() {
  $('fieldDate').value = new Date().toISOString().split('T')[0];
  $('fieldIntitule').value = '';
  $('fieldMontant').value = '';
  $('fieldCategorie').value = '';
  $('fieldNote').value = '';
  $('charCount').textContent = '0';
  setType('DÃ©pense');
  hideToast();
  document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));
}

function validateForm() {
  const fields = ['fieldDate', 'fieldIntitule', 'fieldMontant', 'fieldCategorie'];
  let valid = true;
  fields.forEach(id => {
    const el = $(id);
    const isEmpty = !el.value.trim() || (id === 'fieldMontant' && parseFloat(el.value) <= 0);
    el.classList.toggle('error', isEmpty);
    if (isEmpty) valid = false;
  });
  return valid;
}

async function handleSubmit() {
  if (!validateForm()) {
    showToast('error', 'âš ï¸ Veuillez remplir tous les champs obligatoires.');
    return;
  }

  setLoading(true);

  const transaction = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    date: $('fieldDate').value,
    intitule: $('fieldIntitule').value.trim(),
    montant: parseFloat($('fieldMontant').value),
    type: state.currentType,
    categorie: $('fieldCategorie').value,
    note: $('fieldNote').value.trim(),
    timestamp: new Date().toISOString(),
  };

  state.transactions.unshift(transaction);
  saveTransactions();
  updateTxnBadge();

  setLoading(false);

  let syncedCloud = false;
  if (state.cloud.enabled && state.cloud.user) {
    try {
      await cloudPushOne(transaction);
      syncedCloud = true;
    } catch (e) {}
  }

  if (state.google.connected && state.google.sheetId) {
    try {
      await appendTransactionToGoogle(transaction);
      if (syncedCloud) showToast('success', 'Operation synchronisee cloud et Google Sheets.');
      else showToast('success', 'Operation enregistree et synchronisee avec Google Sheets.');
    } catch (e) {
      if (syncedCloud) showToast('success', 'Operation synchronisee cloud. Sync Google en attente.');
      else showToast('success', 'Operation enregistree localement. Sync Google en attente.');
    }
  } else {
    if (syncedCloud) showToast('success', 'Operation synchronisee avec le cloud.');
    else showToast('success', 'Operation enregistree localement.');
  }

  setTimeout(resetForm, 2200);
}

function setLoading(loading) {
  $('btnSubmit').disabled = loading;
  $('btnSubmit').querySelector('.btn-text').classList.toggle('hidden', loading);
  $('btnSubmit').querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

function showToast(type, msg) {
  const toast = $('toast');
  toast.className = `toast ${type}`;
  $('toastMsg').textContent = msg;
  hideToast._timer && clearTimeout(hideToast._timer);
  hideToast._timer = setTimeout(hideToast, 5000);
}

function hideToast() { $('toast').className = 'toast hidden'; }

// ============ DASHBOARD ============
function getMonthTransactions() {
  const key = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  return state.transactions.filter(t => monthKey(t.date) === key);
}

function refreshDashboard() {
  const txns = getMonthTransactions();
  const income = txns.filter(t => t.type === 'Recette').reduce((s, t) => s + t.montant, 0);
  const expense = txns.filter(t => t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0);
  const balance = income - expense;

  $('kpiBalance').textContent = (balance >= 0 ? '+' : 'âˆ’') + ' ' + fmt(Math.abs(balance));
  $('kpiIncome').textContent = fmt(income);
  $('kpiExpense').textContent = fmt(expense);
  $('kpiIncomeCount').textContent = txns.filter(t => t.type === 'Recette').length + ' opÃ©ration(s)';
  $('kpiExpenseCount').textContent = txns.filter(t => t.type === 'DÃ©pense').length + ' opÃ©ration(s)';

  const pct = income > 0 ? Math.min(100, Math.round((balance / income) * 100)) : 0;
  $('kpiBalanceFill').style.width = Math.max(0, pct) + '%';
  $('kpiBalanceTrend').textContent = income > 0 ? `Taux d'Ã©pargne: ${pct}%` : 'Aucune recette ce mois';

  renderRecentTxns(txns.slice(0, 6));
  renderDonutChart(txns);
  renderBarChart();
}

function renderRecentTxns(txns) {
  const container = $('recentTxns');
  if (!txns.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">ðŸ“Š</div>
        <p>Aucune opÃ©ration ce mois</p>
        <button class="btn-primary" data-view="add" style="margin-top:8px;font-size:0.8rem;padding:8px 16px">Ajouter</button>
      </div>`;
    const addBtn = container.querySelector('[data-view]');
    if (addBtn) addBtn.addEventListener('click', () => navigateTo('add'));
    return;
  }
  container.innerHTML = txns.map(t => `
    <div class="txn-item">
      <div class="txn-avatar ${t.type === 'DÃ©pense' ? 'expense' : 'income'}">
        ${getCatIcon(t.categorie, t.type)}
      </div>
      <div class="txn-info">
        <div class="txn-name">${escHtml(t.intitule)}</div>
        <div class="txn-meta">${fmtDate(t.date)} Â· ${escHtml(t.categorie)}</div>
      </div>
      <div class="txn-amount ${t.type === 'DÃ©pense' ? 'expense' : 'income'}">
        ${t.type === 'DÃ©pense' ? 'âˆ’' : '+'} ${fmt(t.montant)}
      </div>
    </div>
  `).join('');
}

function renderDonutChart(txns) {
  const ctx = $('donutChart').getContext('2d');
  const catMap = {};
  txns.filter(t => t.type === 'DÃ©pense').forEach(t => {
    catMap[t.categorie] = (catMap[t.categorie] || 0) + t.montant;
  });

  const income = txns.filter(t => t.type === 'Recette').reduce((s, t) => s + t.montant, 0);
  const expense = txns.filter(t => t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0);
  const saved = Math.max(0, income - expense);
  const pct = income > 0 ? Math.round((saved / income) * 100) : 0;
  $('donutPct').textContent = pct + '%';

  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (saved > 0) cats.push(['Ã‰pargne', saved]);

  if (state.charts.donut) state.charts.donut.destroy();

  if (!cats.length) {
    $('donutLegend').innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted)">Aucune donnÃ©e</span>';
    return;
  }

  state.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c[0]),
      datasets: [{
        data: cats.map(c => c[1]),
        backgroundColor: cats.map((_, i) => CONFIG.CHART_COLORS[i % CONFIG.CHART_COLORS.length]),
        borderWidth: 2,
        borderColor: '#13172E',
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '74%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` },
          bodyFont: { family: 'Plus Jakarta Sans' },
          backgroundColor: '#1E2340',
          borderColor: 'rgba(255,255,255,0.06)',
          borderWidth: 1,
        },
      },
      animation: { animateRotate: true, duration: 700 },
    },
  });

  $('donutLegend').innerHTML = cats.map((c, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${CONFIG.CHART_COLORS[i % CONFIG.CHART_COLORS.length]}"></div>
      <span class="legend-name">${escHtml(c[0])}</span>
      <span class="legend-val">${fmt(c[1])}</span>
    </div>
  `).join('');
}

function renderBarChart() {
  const ctx = $('barChart').getContext('2d');
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(state.currentYear, state.currentMonth - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
    });
  }

  const incomes = months.map(m => state.transactions.filter(t => monthKey(t.date) === m.key && t.type === 'Recette').reduce((s, t) => s + t.montant, 0));
  const expenses = months.map(m => state.transactions.filter(t => monthKey(t.date) === m.key && t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0));

  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Income',
          data: incomes,
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Spend',
          data: expenses,
          backgroundColor: 'rgba(76,111,255,0.7)',
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            font: { family: 'Plus Jakarta Sans', size: 11 },
            color: '#8892B0',
            boxWidth: 10, boxHeight: 10, borderRadius: 3,
          },
        },
        tooltip: {
          backgroundColor: '#1E2340',
          borderColor: 'rgba(255,255,255,0.06)',
          borderWidth: 1,
          bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#4A5280' },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#4A5280', callback: (v) => fmt(v).replace(' FCFA', '') },
        },
      },
    },
  });
}

// ============ HISTORY ============
function initHistory() {
  ['filterSearch', 'filterType', 'filterCat', 'filterMonth'].forEach(id => {
    $(id).addEventListener('input', applyFilters);
    $(id).addEventListener('change', applyFilters);
  });

  document.querySelectorAll('.txn-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      if (state.sortField === field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortField = field; state.sortDir = 'desc'; }
      applyFilters();
    });
  });
}

function refreshHistory() {
  const months = [...new Set(state.transactions.map(t => monthKey(t.date)).filter(Boolean))].sort().reverse();
  const monthSel = $('filterMonth');
  const curMonth = monthSel.value;
  monthSel.innerHTML = '<option value="">Tous les mois</option>';
  months.forEach(m => {
    const [y, mo] = m.split('-');
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    monthSel.appendChild(opt);
  });
  monthSel.value = curMonth;

  const cats = [...new Set(state.transactions.map(t => t.categorie).filter(Boolean))].sort();
  const catSel = $('filterCat');
  catSel.innerHTML = '<option value="">Toutes catÃ©gories</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catSel.appendChild(opt);
  });

  applyFilters();
}

function applyFilters() {
  const search = $('filterSearch').value.toLowerCase().trim();
  const type = $('filterType').value;
  const cat = $('filterCat').value;
  const month = $('filterMonth').value;

  let txns = [...state.transactions];
  if (search) txns = txns.filter(t => t.intitule.toLowerCase().includes(search) || (t.note || '').toLowerCase().includes(search) || t.categorie.toLowerCase().includes(search));
  if (type) txns = txns.filter(t => t.type === type);
  if (cat) txns = txns.filter(t => t.categorie === cat);
  if (month) txns = txns.filter(t => monthKey(t.date) === month);

  txns.sort((a, b) => {
    let va = a[state.sortField], vb = b[state.sortField];
    if (state.sortField === 'montant') { va = a.montant; vb = b.montant; }
    if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const income = txns.filter(t => t.type === 'Recette').reduce((s, t) => s + t.montant, 0);
  const expense = txns.filter(t => t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0);
  $('filterResultCount').textContent = txns.length + ' rÃ©sultat' + (txns.length > 1 ? 's' : '');
  $('filterIncomeSum').textContent = 'Recettes: ' + fmt(income);
  $('filterExpenseSum').textContent = 'DÃ©penses: ' + fmt(expense);
  $('filterBalance').textContent = 'Solde: ' + (income - expense >= 0 ? '+' : 'âˆ’') + fmt(Math.abs(income - expense));

  const tbody = $('txnTableBody');
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><div class="empty-state"><div class="empty-icon">ðŸ”</div><p>Aucun rÃ©sultat</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = txns.map(t => `
    <tr>
      <td style="color:var(--text-secondary);font-size:0.8rem">${fmtDate(t.date)}</td>
      <td>
        <div style="font-weight:600">${escHtml(t.intitule)}</div>
        ${t.note ? `<div style="font-size:0.72rem;color:var(--text-muted)">${escHtml(t.note)}</div>` : ''}
      </td>
      <td><span class="cat-pill">${getCatIcon(t.categorie, t.type)} ${escHtml(t.categorie)}</span></td>
      <td><span class="type-badge ${t.type === 'DÃ©pense' ? 'depense' : 'recette'}">${t.type}</span></td>
      <td class="amount-cell ${t.type === 'DÃ©pense' ? 'depense' : 'recette'}">
        ${t.type === 'DÃ©pense' ? 'âˆ’' : '+'} ${fmt(t.montant)}
      </td>
    </tr>
  `).join('');
}

// ============ ANALYTICS ============
function refreshAnalytics() {
  const txns = state.transactions;
  const income = txns.filter(t => t.type === 'Recette').reduce((s, t) => s + t.montant, 0);
  const expense = txns.filter(t => t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0);
  const saved = Math.max(0, income - expense);
  const rate = income > 0 ? Math.round((saved / income) * 100) : 0;

  $('savingsRate').textContent = rate + '%';

  $('savingsBreakdown').innerHTML = `
    <div class="savings-row"><span class="savings-row-label">Total recettes</span><span class="savings-row-val amount-green">${fmt(income)}</span></div>
    <div class="savings-row"><span class="savings-row-label">Total dÃ©penses</span><span class="savings-row-val amount-red">${fmt(expense)}</span></div>
    <div class="savings-row"><span class="savings-row-label">Ã‰pargne nette</span><span class="savings-row-val" style="color:var(--accent-2)">${fmt(saved)}</span></div>
    <div class="savings-row"><span class="savings-row-label">Transactions</span><span class="savings-row-val">${txns.length}</span></div>
  `;

  const sCtx = $('savingsChart').getContext('2d');
  if (state.charts.savings) state.charts.savings.destroy();
  state.charts.savings = new Chart(sCtx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [saved || 0.001, expense || 0.001],
        backgroundColor: ['#4C6FFF', 'rgba(255,255,255,0.05)'],
        borderWidth: 0,
      }],
    },
    options: {
      cutout: '82%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 700 },
    },
  });

  const expCats = {};
  txns.filter(t => t.type === 'DÃ©pense').forEach(t => { expCats[t.categorie] = (expCats[t.categorie] || 0) + t.montant; });
  const topExp = Object.entries(expCats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxExp = (topExp[0] && topExp[0][1]) ? topExp[0][1] : 1;

  $('topExpenses').innerHTML = topExp.length ? topExp.map(([cat, val], i) => `
    <div class="top-item">
      <div class="top-rank">#${i+1}</div>
      <div class="top-bar-wrap">
        <div class="top-bar-label">${getCatIcon(cat, 'DÃ©pense')} ${escHtml(cat)}</div>
        <div class="top-bar-track"><div class="top-bar-fill expense" style="width:${(val/maxExp*100).toFixed(1)}%"></div></div>
      </div>
      <div class="top-val amount-red">âˆ’${fmt(val)}</div>
    </div>
  `).join('') : '<p style="font-size:0.8rem;color:var(--text-muted)">Aucune dÃ©pense</p>';

  const incCats = {};
  txns.filter(t => t.type === 'Recette').forEach(t => { incCats[t.categorie] = (incCats[t.categorie] || 0) + t.montant; });
  const topInc = Object.entries(incCats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxInc = (topInc[0] && topInc[0][1]) ? topInc[0][1] : 1;

  $('topIncomes').innerHTML = topInc.length ? topInc.map(([cat, val], i) => `
    <div class="top-item">
      <div class="top-rank">#${i+1}</div>
      <div class="top-bar-wrap">
        <div class="top-bar-label">${getCatIcon(cat, 'Recette')} ${escHtml(cat)}</div>
        <div class="top-bar-track"><div class="top-bar-fill income" style="width:${(val/maxInc*100).toFixed(1)}%"></div></div>
      </div>
      <div class="top-val amount-green">+${fmt(val)}</div>
    </div>
  `).join('') : '<p style="font-size:0.8rem;color:var(--text-muted)">Aucune recette</p>';

  renderLineChart();
}

function renderLineChart() {
  const ctx = $('lineChart').getContext('2d');
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(state.currentYear, state.currentMonth - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
    });
  }

  const incomes = months.map(m => state.transactions.filter(t => monthKey(t.date) === m.key && t.type === 'Recette').reduce((s, t) => s + t.montant, 0));
  const expenses = months.map(m => state.transactions.filter(t => monthKey(t.date) === m.key && t.type === 'DÃ©pense').reduce((s, t) => s + t.montant, 0));
  const balances = incomes.map((inc, i) => inc - expenses[i]);

  if (state.charts.line) state.charts.line.destroy();
  state.charts.line = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Income',
          data: incomes,
          backgroundColor: 'rgba(255,255,255,0.85)',
          borderRadius: 5,
          borderSkipped: false,
          order: 2,
        },
        {
          label: 'Spend',
          data: expenses,
          backgroundColor: 'rgba(76,111,255,0.6)',
          borderRadius: 5,
          borderSkipped: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#8892B0', boxWidth: 10, boxHeight: 10, borderRadius: 3 },
        },
        tooltip: {
          backgroundColor: '#1E2340',
          borderColor: 'rgba(255,255,255,0.06)',
          borderWidth: 1,
          bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#4A5280' } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#4A5280', callback: (v) => fmt(v).replace(' FCFA', '') } },
      },
    },
  });
}

// ============ EXPORT ============
function initExport() {
  $('exportBtn').addEventListener('click', exportCSV);
}

function exportCSV() {
  const headers = ['Date', 'IntitulÃ©', 'CatÃ©gorie', 'Type', 'Montant (FCFA)', 'Note'];
  const rows = state.transactions.map(t => [t.date, t.intitule, t.categorie, t.type, t.montant, t.note || '']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flux-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ SECURITY ============
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============ DEMO DATA ============
function seedDemoData() {
  if (state.transactions.length > 0) return;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const mp = String(m).padStart(2, '0'), pmp = String(pm).padStart(2, '0');

  const demos = [
    { date: `${y}-${mp}-01`, intitule: 'Salaire du mois', montant: 250000, type: 'Recette', categorie: 'Salaire', note: 'Virement employeur' },
    { date: `${y}-${mp}-02`, intitule: 'Loyer appartement', montant: 75000, type: 'DÃ©pense', categorie: 'Logement', note: '' },
    { date: `${y}-${mp}-03`, intitule: 'Courses alimentaires', montant: 35000, type: 'DÃ©pense', categorie: 'Alimentation', note: 'SupermarchÃ©' },
    { date: `${y}-${mp}-05`, intitule: 'Facture tÃ©lÃ©phone', montant: 8500, type: 'DÃ©pense', categorie: 'Communication', note: '' },
    { date: `${y}-${mp}-07`, intitule: 'Freelance design', montant: 55000, type: 'Recette', categorie: 'Freelance', note: 'Client ABC' },
    { date: `${y}-${mp}-08`, intitule: 'Restaurant midi', montant: 4500, type: 'DÃ©pense', categorie: 'Alimentation', note: '' },
    { date: `${y}-${mp}-10`, intitule: 'Transport bus', montant: 3200, type: 'DÃ©pense', categorie: 'Transport', note: '' },
    { date: `${y}-${mp}-12`, intitule: 'MÃ©dicaments pharmacie', montant: 12000, type: 'DÃ©pense', categorie: 'SantÃ©', note: '' },
    { date: `${y}-${mp}-14`, intitule: 'Transfert reÃ§u famille', montant: 25000, type: 'Recette', categorie: 'Transfert reÃ§u', note: '' },
    { date: `${y}-${mp}-15`, intitule: 'Livres scolaires', montant: 18000, type: 'DÃ©pense', categorie: 'Ã‰ducation', note: '' },
    { date: `${py}-${pmp}-01`, intitule: 'Salaire', montant: 250000, type: 'Recette', categorie: 'Salaire', note: '' },
    { date: `${py}-${pmp}-02`, intitule: 'Loyer', montant: 75000, type: 'DÃ©pense', categorie: 'Logement', note: '' },
    { date: `${py}-${pmp}-05`, intitule: 'Commerce marchÃ©', montant: 42000, type: 'Recette', categorie: 'Commerce', note: '' },
    { date: `${py}-${pmp}-10`, intitule: 'Alimentation semaine', montant: 28000, type: 'DÃ©pense', categorie: 'Alimentation', note: '' },
    { date: `${py}-${pmp}-15`, intitule: 'Transport', montant: 5000, type: 'DÃ©pense', categorie: 'Transport', note: '' },
    { date: `${py}-${pmp}-20`, intitule: 'VÃªtements enfants', montant: 22000, type: 'DÃ©pense', categorie: 'VÃªtements', note: '' },
  ];

  demos.forEach((d, i) => state.transactions.push({ id: 'demo_' + i, ...d, timestamp: new Date(d.date).toISOString() }));
  saveTransactions();
}

// ============ BOOT ============
async function init() {
  try {
    loadTransactions();
    if (CONFIG.ENABLE_DEMO_DATA) seedDemoData();
    initNavigation();
    initForm();
    initHistory();
    initExport();
    initGoogle();
    await initCloud();  // Attendre l'initialisation cloud
    updateMonthLabel();
    updateTxnBadge();
    refreshDashboard();
  } catch (error) {
    console.error('Erreur lors de l\'initialisation de l\'application:', error);
    showToast('error', 'Erreur lors du chargement de l\'application. Veuillez rafraîchir la page.');
  }
}

document.addEventListener('DOMContentLoaded', init);
