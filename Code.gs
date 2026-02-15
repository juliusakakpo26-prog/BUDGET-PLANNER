/**
 * FLUX — Budget App | Google Apps Script Backend
 * ================================================
 * Fichier : Code.gs
 * Hébergement : Google Apps Script → Web App
 * 
 * INSTRUCTIONS DE DÉPLOIEMENT :
 * 1. Ouvrir script.google.com
 * 2. Créer un nouveau projet
 * 3. Coller ce code dans Code.gs
 * 4. Déployer → Nouvelle application Web
 *    - Exécuter en tant que : Moi
 *    - Accès : Tout le monde
 * 5. Copier l'URL et la coller dans app.js → CONFIG.APPS_SCRIPT_URL
 */

// ============ CONFIGURATION ============
const SHEET_NAME = 'Transactions';
const SPREADSHEET_ID = ''; // Laisser vide = utilisera le spreadsheet parent du script

// Colonnes du Google Sheet
const COLUMNS = {
  ID: 1,
  DATE: 2,
  INTITULE: 3,
  MONTANT: 4,
  TYPE: 5,
  CATEGORIE: 6,
  NOTE: 7,
  TIMESTAMP: 8,
};

// ============ POINT D'ENTRÉE HTTP ============

/**
 * GET : Lecture des transactions
 */
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || 'getAll';
    
    let result;
    
    switch(action) {
      case 'getAll':
        result = getAllTransactions(params);
        break;
      case 'getSummary':
        result = getSummary(params);
        break;
      case 'ping':
        result = { status: 'ok', timestamp: new Date().toISOString() };
        break;
      default:
        result = { error: 'Action inconnue : ' + action };
    }
    
    return buildResponse(result);
    
  } catch(err) {
    return buildErrorResponse(err);
  }
}

/**
 * POST : Ajout d'une transaction
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'add';
    
    let result;
    
    switch(action) {
      case 'add':
        result = addTransaction(body);
        break;
      case 'delete':
        result = deleteTransaction(body.id);
        break;
      case 'update':
        result = updateTransaction(body);
        break;
      case 'bulkImport':
        result = bulkImport(body.transactions || []);
        break;
      default:
        result = { error: 'Action inconnue : ' + action };
    }
    
    return buildResponse(result);
    
  } catch(err) {
    return buildErrorResponse(err);
  }
}

// ============ CRUD OPERATIONS ============

/**
 * Ajouter une transaction dans le Google Sheet
 */
function addTransaction(data) {
  const sheet = getOrCreateSheet();
  
  // Validation serveur
  const validation = validateTransaction(data);
  if (!validation.valid) {
    return { result: 'error', message: validation.message };
  }
  
  const id = data.id || generateId();
  const timestamp = data.timestamp || new Date().toISOString();
  
  const row = [
    id,
    data.date,
    data.intitule,
    parseFloat(data.montant),
    data.type,
    data.categorie,
    data.note || '',
    timestamp,
  ];
  
  sheet.appendRow(row);
  
  // Auto-format de la ligne ajoutée
  const lastRow = sheet.getLastRow();
  formatLastRow(sheet, lastRow);
  
  return {
    result: 'success',
    message: 'Transaction ajoutée avec succès',
    id: id,
    row: lastRow,
  };
}

/**
 * Récupérer toutes les transactions avec filtres optionnels
 */
function getAllTransactions(params) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    return { result: 'success', transactions: [], total: 0 };
  }
  
  let transactions = data.slice(1).map(row => ({
    id: row[COLUMNS.ID - 1],
    date: row[COLUMNS.DATE - 1] instanceof Date 
      ? Utilities.formatDate(row[COLUMNS.DATE - 1], Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : row[COLUMNS.DATE - 1],
    intitule: row[COLUMNS.INTITULE - 1],
    montant: parseFloat(row[COLUMNS.MONTANT - 1]) || 0,
    type: row[COLUMNS.TYPE - 1],
    categorie: row[COLUMNS.CATEGORIE - 1],
    note: row[COLUMNS.NOTE - 1] || '',
    timestamp: row[COLUMNS.TIMESTAMP - 1],
  })).filter(t => t.id && t.intitule); // Filtrer lignes vides
  
  // Filtres optionnels
  if (params.type) {
    transactions = transactions.filter(t => t.type === params.type);
  }
  if (params.categorie) {
    transactions = transactions.filter(t => t.categorie === params.categorie);
  }
  if (params.month) {
    transactions = transactions.filter(t => String(t.date).startsWith(params.month));
  }
  if (params.from) {
    transactions = transactions.filter(t => t.date >= params.from);
  }
  if (params.to) {
    transactions = transactions.filter(t => t.date <= params.to);
  }
  
  // Tri par date décroissante par défaut
  transactions.sort((a, b) => b.date > a.date ? 1 : -1);
  
  return {
    result: 'success',
    transactions: transactions,
    total: transactions.length,
  };
}

/**
 * Calculer les indicateurs de synthèse
 */
function getSummary(params) {
  const all = getAllTransactions(params);
  const txns = all.transactions;
  
  const income = txns.filter(t => t.type === 'Recette').reduce((s, t) => s + t.montant, 0);
  const expense = txns.filter(t => t.type === 'Dépense').reduce((s, t) => s + t.montant, 0);
  const balance = income - expense;
  const savingsRate = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;
  
  // Par catégorie
  const byCategory = {};
  txns.forEach(t => {
    if (!byCategory[t.categorie]) byCategory[t.categorie] = { type: t.type, total: 0, count: 0 };
    byCategory[t.categorie].total += t.montant;
    byCategory[t.categorie].count++;
  });
  
  return {
    result: 'success',
    summary: {
      income: income,
      expense: expense,
      balance: balance,
      savingsRate: savingsRate,
      count: txns.length,
      byCategory: byCategory,
    },
  };
}

/**
 * Supprimer une transaction par ID
 */
function deleteTransaction(id) {
  if (!id) return { result: 'error', message: 'ID requis' };
  
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][COLUMNS.ID - 1] == id) {
      sheet.deleteRow(i + 1);
      return { result: 'success', message: 'Transaction supprimée', id: id };
    }
  }
  
  return { result: 'error', message: 'Transaction non trouvée : ' + id };
}

/**
 * Mettre à jour une transaction
 */
function updateTransaction(data) {
  if (!data.id) return { result: 'error', message: 'ID requis' };
  
  const validation = validateTransaction(data);
  if (!validation.valid) return { result: 'error', message: validation.message };
  
  const sheet = getOrCreateSheet();
  const sheetData = sheet.getDataRange().getValues();
  
  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][COLUMNS.ID - 1] == data.id) {
      const range = sheet.getRange(i + 1, 1, 1, 8);
      range.setValues([[
        data.id,
        data.date,
        data.intitule,
        parseFloat(data.montant),
        data.type,
        data.categorie,
        data.note || '',
        new Date().toISOString(),
      ]]);
      return { result: 'success', message: 'Transaction mise à jour', id: data.id };
    }
  }
  
  return { result: 'error', message: 'Transaction non trouvée' };
}

/**
 * Import en masse
 */
function bulkImport(transactions) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return { result: 'error', message: 'Tableau de transactions requis' };
  }
  
  const sheet = getOrCreateSheet();
  let added = 0, errors = 0;
  
  transactions.forEach(t => {
    try {
      const validation = validateTransaction(t);
      if (validation.valid) {
        sheet.appendRow([
          t.id || generateId(),
          t.date,
          t.intitule,
          parseFloat(t.montant),
          t.type,
          t.categorie,
          t.note || '',
          t.timestamp || new Date().toISOString(),
        ]);
        added++;
      } else {
        errors++;
      }
    } catch(e) {
      errors++;
    }
  });
  
  return {
    result: 'success',
    message: `${added} transaction(s) importée(s), ${errors} erreur(s)`,
    added: added,
    errors: errors,
  };
}

// ============ HELPERS ============

function getOrCreateSheet() {
  let ss;
  if (SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    initSheetHeaders(sheet);
  }
  
  return sheet;
}

function initSheetHeaders(sheet) {
  const headers = ['ID', 'Date', 'Intitulé', 'Montant', 'Type', 'Catégorie', 'Note', 'Timestamp'];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Styles des en-têtes
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#4F46E5');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setFontFamily('Google Sans');
  
  // Freeze la première ligne
  sheet.setFrozenRows(1);
  
  // Largeurs de colonnes
  sheet.setColumnWidth(1, 120); // ID
  sheet.setColumnWidth(2, 110); // Date
  sheet.setColumnWidth(3, 200); // Intitulé
  sheet.setColumnWidth(4, 120); // Montant
  sheet.setColumnWidth(5, 90);  // Type
  sheet.setColumnWidth(6, 150); // Catégorie
  sheet.setColumnWidth(7, 200); // Note
  sheet.setColumnWidth(8, 180); // Timestamp
  
  // Bordures
  headerRange.setBorder(null, null, true, null, null, null, '#E4E7EC', SpreadsheetApp.BorderStyle.SOLID);
}

function formatLastRow(sheet, rowNum) {
  const row = sheet.getRange(rowNum, 1, 1, 8);
  
  // Alternance de couleur
  if (rowNum % 2 === 0) {
    row.setBackground('#F8F9FE');
  } else {
    row.setBackground('#FFFFFF');
  }
  
  // Format montant
  sheet.getRange(rowNum, COLUMNS.MONTANT).setNumberFormat('#,##0');
  
  // Couleur selon type
  const typeVal = sheet.getRange(rowNum, COLUMNS.TYPE).getValue();
  const amountCell = sheet.getRange(rowNum, COLUMNS.MONTANT);
  if (typeVal === 'Dépense') {
    amountCell.setFontColor('#DC2626');
  } else if (typeVal === 'Recette') {
    amountCell.setFontColor('#059669');
  }
}

function validateTransaction(data) {
  if (!data.date) return { valid: false, message: 'Date requise' };
  if (!data.intitule || String(data.intitule).trim().length === 0) return { valid: false, message: 'Intitulé requis' };
  if (!data.montant || parseFloat(data.montant) <= 0) return { valid: false, message: 'Montant invalide (doit être > 0)' };
  if (!['Dépense', 'Recette'].includes(data.type)) return { valid: false, message: 'Type invalide (Dépense ou Recette)' };
  if (!data.categorie) return { valid: false, message: 'Catégorie requise' };
  return { valid: true };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildErrorResponse(err) {
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'error', message: err.toString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ UTILITAIRES FEUILLE ============

/**
 * Créer un dashboard récapitulatif dans une seconde feuille
 * À appeler manuellement depuis l'éditeur Apps Script
 */
function createDashboardSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dashboard = ss.getSheetByName('Dashboard');
  
  if (!dashboard) {
    dashboard = ss.insertSheet('Dashboard');
  } else {
    dashboard.clear();
  }
  
  // En-tête
  dashboard.getRange('A1').setValue('📊 FLUX — Tableau de bord');
  dashboard.getRange('A1').setFontSize(16).setFontWeight('bold').setFontColor('#4F46E5');
  
  dashboard.getRange('A3').setValue('Résumé global');
  dashboard.getRange('A3').setFontWeight('bold');
  
  // Formules liées à la feuille Transactions
  const formulas = [
    ['Total Recettes', `=SUMIF(Transactions!E:E,"Recette",Transactions!D:D)`],
    ['Total Dépenses', `=SUMIF(Transactions!E:E,"Dépense",Transactions!D:D)`],
    ['Solde Net', `=B5-B6`],
    ["Nb. Transactions", `=COUNTA(Transactions!A:A)-1`],
    ["Taux d'épargne", `=IF(B5>0,ROUND((B7/B5)*100,1)&"%","N/A")`],
  ];
  
  formulas.forEach((f, i) => {
    dashboard.getRange(4 + i, 1).setValue(f[0]);
    dashboard.getRange(4 + i, 2).setFormula(f[1]);
  });
  
  // Formatage
  dashboard.getRange('B5').setNumberFormat('#,##0 "FCFA"').setFontColor('#059669');
  dashboard.getRange('B6').setNumberFormat('#,##0 "FCFA"').setFontColor('#DC2626');
  dashboard.getRange('B7').setNumberFormat('#,##0 "FCFA"').setFontColor('#4F46E5');
  
  dashboard.setColumnWidth(1, 180);
  dashboard.setColumnWidth(2, 150);
  
  SpreadsheetApp.getUi().alert('✅ Dashboard créé avec succès !');
}

/**
 * Générer un rapport mensuel
 * Usage : appelable depuis Apps Script ou trigger mensuel
 */
function generateMonthlyReport() {
  const now = new Date();
  const month = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  
  const summary = getSummary({ month: month });
  const s = summary.summary;
  
  const report = `
📅 Rapport mensuel — ${month}
================================
💰 Recettes    : ${s.income.toLocaleString()} FCFA
💸 Dépenses    : ${s.expense.toLocaleString()} FCFA
📊 Solde       : ${s.balance.toLocaleString()} FCFA
📈 Taux épargne: ${s.savingsRate}%
📋 Transactions: ${s.count}
================================
Généré le ${now.toLocaleString()}
  `.trim();
  
  Logger.log(report);
  return report;
}
