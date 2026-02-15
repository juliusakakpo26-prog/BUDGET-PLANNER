/**
 * Flux - Optional Google Apps Script backend
 * This backend is optional because the app can sync directly with Google Sheets API.
 * Use this only if you want a server endpoint between frontend and Sheets.
 */

const SHEET_NAME = 'Transactions';
const HEADERS = ['ID', 'Date', 'Intitule', 'Montant', 'Type', 'Categorie', 'Note', 'Timestamp'];

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    if (action === 'ping') return jsonResponse({ result: 'success', status: 'ok', time: new Date().toISOString() });
    if (action === 'getAll') return jsonResponse(getAllTransactions());
    return jsonResponse({ result: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ result: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action || 'add';

    if (action === 'add') return jsonResponse(addTransaction(body));
    if (action === 'bulkImport') return jsonResponse(bulkImport(body.transactions || []));
    if (action === 'clear') return jsonResponse(clearTransactions());

    return jsonResponse({ result: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ result: 'error', message: String(err) });
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function validateTransaction(t) {
  if (!t) return 'Missing payload';
  if (!t.date) return 'Date is required';
  if (!t.intitule) return 'Intitule is required';
  if (!t.montant || Number(t.montant) <= 0) return 'Montant must be > 0';
  if (!t.type || (t.type !== 'Depense' && t.type !== 'Recette' && t.type !== 'Dépense')) return 'Type must be Depense or Recette';
  if (!t.categorie) return 'Categorie is required';
  return '';
}

function addTransaction(t) {
  const err = validateTransaction(t);
  if (err) return { result: 'error', message: err };

  const sh = getSheet();
  const row = [
    t.id || Utilities.getUuid(),
    t.date,
    t.intitule,
    Number(t.montant),
    t.type,
    t.categorie,
    t.note || '',
    t.timestamp || new Date().toISOString(),
  ];
  sh.appendRow(row);
  return { result: 'success' };
}

function getAllTransactions() {
  const sh = getSheet();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return { result: 'success', transactions: [] };

  const tx = data.slice(1).map(r => ({
    id: String(r[0] || ''),
    date: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
    intitule: String(r[2] || ''),
    montant: Number(r[3] || 0),
    type: String(r[4] || ''),
    categorie: String(r[5] || ''),
    note: String(r[6] || ''),
    timestamp: String(r[7] || ''),
  })).filter(t => t.id && t.intitule);

  tx.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { result: 'success', transactions: tx };
}

function bulkImport(items) {
  if (!Array.isArray(items) || !items.length) return { result: 'error', message: 'transactions array is required' };
  const sh = getSheet();
  const rows = [];

  items.forEach(t => {
    const err = validateTransaction(t);
    if (!err) {
      rows.push([
        t.id || Utilities.getUuid(),
        t.date,
        t.intitule,
        Number(t.montant),
        t.type,
        t.categorie,
        t.note || '',
        t.timestamp || new Date().toISOString(),
      ]);
    }
  });

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  return { result: 'success', imported: rows.length };
}

function clearTransactions() {
  const sh = getSheet();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  return { result: 'success' };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
