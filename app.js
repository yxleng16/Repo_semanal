/* ============ Estado y persistencia ============ */

const STORAGE_KEY = 'nunu_stock_db_v1';
const STORES = ['AMIGO', 'MADRID', 'RAMBLA', 'VALENCIA'];
const STORE_LABELS = { AMIGO: 'Amigó', MADRID: 'Madrid', RAMBLA: 'Rambla', VALENCIA: 'Valencia' };
const STORE_ABBR = { AMIGO: 'AMI', MADRID: 'MAD', RAMBLA: 'RAM', VALENCIA: 'VLC' };
// Orden exacto en el que deben salir los 12 CSV de traspaso.
const MOVEMENT_ORDER = STORES.flatMap(from => STORES.filter(to => to !== from).map(to => [from, to]));

function defaultState() {
  return {
    catalogRules: {
      whPrefix: 'WH-',
      aliasOro: ['ORO', 'OR', 'GOLD'],
      aliasRodio: ['RODIO', 'RO', 'RH'],
      materialDefault: 'ORO',
    },
    config: {
      salesWindowDays: 30, salesThreshold: 15, warnLastUnit: true, secondaryCriterion: 'ventas_asc',
      top20ExcludePrefixes: ['ACC', 'GC'],
      top20ExcludeKeywords: ['gift card', 'tarjeta regalo', 'envoltorio', 'papel de regalo', 'bolsa de regalo', 'accesorio', 'gift wrap'],
      // Reglas de traspaso de la repo semanal (ver computeMovimientosParaFila).
      repoBufferMadrid: 2,
      repoBufferRamblaValencia: 1,
      repoAmigoProtectedMargin: 1,
      repoAmigoTop20MinStock: 3,
    },
    facturaConfig: { empresaNombre: '', empresaNif: '', empresaDireccion: '', ivaPorcentaje: 21, facturaCounter: 1 },
    catalog: [],            // {base, talla, material, matchKey, nombre, variante, whSku, searchText}
    stockWholesale: {},     // whSku (literal) -> qty
    storeStock: { AMIGO: {}, MADRID: {}, RAMBLA: {}, VALENCIA: {} },   // matchKey -> {rawSku, qty, nombre}
    storeSales: { AMIGO: {}, MADRID: {}, RAMBLA: {}, VALENCIA: {} },   // matchKey -> {rawSku, qty, nombre} en ventana
    pedido: [],              // {whSku, nombre, cantidad, pendienteCatalogo?, base?, talla?, material?, matchKey?} — pedido actualmente abierto
    dashboard: [],           // resultado calculado del pedido actualmente abierto
    pedidos: [],             // pedidos guardados: {id, titulo, cliente, creadoEn, actualizadoEn, pedido, dashboard}
    pedidoActualId: null,    // id del pedido abierto en state.pedido/state.dashboard, o null si es un borrador sin guardar
    repoSemanal: { rows: [], colFilters: [], onlyWithMovement: false, hideTop20: false, sortBy: null }, // rows: [{sku, nombre, stock:{AMIGO..}, sales:{AMIGO..}, movimientos:[{from,to,qty}], top20:{AMIGO..}}]; sortBy: {key, dir} | null
  };
}

let state = loadState();

// Merge en profundidad (2 niveles) para que un catalogRules/config guardado con
// una versión anterior de la app no borre campos nuevos que añadamos después.
function mergeIntoDefault(parsed) {
  const def = defaultState();
  const merged = Object.assign({}, def, parsed);
  merged.catalogRules = Object.assign({}, def.catalogRules, parsed && parsed.catalogRules);
  if (!Array.isArray(merged.catalogRules.aliasOro)) merged.catalogRules.aliasOro = def.catalogRules.aliasOro;
  if (!Array.isArray(merged.catalogRules.aliasRodio)) merged.catalogRules.aliasRodio = def.catalogRules.aliasRodio;
  merged.config = Object.assign({}, def.config, parsed && parsed.config);
  if (!Array.isArray(merged.config.top20ExcludePrefixes)) merged.config.top20ExcludePrefixes = def.config.top20ExcludePrefixes;
  if (!Array.isArray(merged.config.top20ExcludeKeywords)) merged.config.top20ExcludeKeywords = def.config.top20ExcludeKeywords;
  ['repoBufferMadrid', 'repoBufferRamblaValencia', 'repoAmigoProtectedMargin', 'repoAmigoTop20MinStock'].forEach(k => {
    if (typeof merged.config[k] !== 'number' || isNaN(merged.config[k])) merged.config[k] = def.config[k];
  });
  merged.facturaConfig = Object.assign({}, def.facturaConfig, parsed && parsed.facturaConfig);
  if (!Array.isArray(merged.pedidos)) merged.pedidos = [];
  merged.pedidos.forEach(p => {
    if (!p.clienteTipo) p.clienteTipo = 'nacional';
    if (p.clienteNif === undefined) p.clienteNif = '';
    if (p.clienteDireccion === undefined) p.clienteDireccion = '';
    if (p.facturaNumero === undefined) p.facturaNumero = null;
    if (p.facturaFecha === undefined) p.facturaFecha = null;
  });
  merged.repoSemanal = Object.assign({}, def.repoSemanal, parsed && parsed.repoSemanal);
  if (!Array.isArray(merged.repoSemanal.rows)) merged.repoSemanal.rows = [];
  if (!Array.isArray(merged.repoSemanal.colFilters)) merged.repoSemanal.colFilters = [];
  if (typeof merged.repoSemanal.onlyWithMovement !== 'boolean') merged.repoSemanal.onlyWithMovement = false;
  if (typeof merged.repoSemanal.hideTop20 !== 'boolean') merged.repoSemanal.hideTop20 = false;
  if (merged.repoSemanal.sortBy === undefined) merged.repoSemanal.sortBy = null;
  merged.repoSemanal.rows.forEach(r => {
    if (!r.stock) r.stock = {};
    if (!r.sales) r.sales = {};
    STORES.forEach(s => { if (r.stock[s] === undefined) r.stock[s] = 0; if (r.sales[s] === undefined) r.sales[s] = 0; });
    if (!Array.isArray(r.movimientos)) r.movimientos = [];
    if (!r.top20) r.top20 = {};
    STORES.forEach(s => { if (r.top20[s] === undefined) r.top20[s] = false; });
  });
  return merged;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeIntoDefault(JSON.parse(raw));
  } catch (e) {
    console.error('No se pudo leer el estado guardado, se inicia vacío.', e);
    return defaultState();
  }
}

// Si hay un pedido guardado abierto, cualquier cambio en el pedido/dashboard
// actual se refleja también en su registro guardado — no hace falta un botón
// de "guardar cambios" aparte, igual que el resto de la app se autoguarda.
function syncActivePedido() {
  if (!state.pedidoActualId) return;
  const rec = state.pedidos.find(p => p.id === state.pedidoActualId);
  if (!rec) return;
  rec.pedido = state.pedido;
  rec.dashboard = state.dashboard;
  rec.actualizadoEn = new Date().toISOString();
}

function saveState() {
  syncActivePedido();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const el = document.getElementById('lastSaved');
  if (el) el.textContent = 'Guardado ' + new Date().toLocaleTimeString('es-ES');
}

/* ============ Utilidades CSV ============ */

function stripBOM(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function detectDelimiter(firstLine) {
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

function parseCSV(text) {
  text = stripBOM(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return { headers: [], rows: [] };
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delim = detectDelimiter(firstLine);

  // Primera pasada: solo localiza saltos de línea reales (ignorando los que
  // caen dentro de un campo entrecomillado), preservando las comillas tal
  // cual para que splitLine() sea la única responsable de desescaparlas.
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      cur += c;
      inQuotes = !inQuotes;
    } else if (c === '\n' && !inQuotes) {
      lines.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.length) lines.push(cur);

  function splitLine(line) {
    const out = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { field += '"'; i++; }
        else q = !q;
        continue;
      }
      if (c === delim && !q) { out.push(field); field = ''; continue; }
      field += c;
    }
    out.push(field);
    return out.map(s => s.trim());
  }

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim().length).map(splitLine);
  return { headers, rows };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}

function toCSV(headerRow, rows) {
  function esc(v) {
    v = String(v ?? '');
    if (/[",;\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  const lines = [headerRow.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\n');
}

function downloadCSV(filename, headerRow, rows) {
  const csv = toCSV(headerRow, rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.textContent = filename;
  return a;
}

/* ============ Mapeo genérico de columnas CSV ============ */

function renderMapping(container, headers, fields, onConfirm) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'mapping-grid';
  const selects = {};

  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'mapping-field';
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : ' (opcional)');
    const select = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '-- no mapear --';
    select.appendChild(blank);
    headers.forEach((h, idx) => {
      const opt = document.createElement('option');
      opt.value = idx; opt.textContent = h;
      if (f.guess && new RegExp(f.guess, 'i').test(h)) opt.selected = true;
      select.appendChild(opt);
    });
    wrap.appendChild(label);
    wrap.appendChild(select);
    grid.appendChild(wrap);
    selects[f.key] = select;
  });

  container.appendChild(grid);
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = 'Confirmar importación';
  btn.onclick = () => {
    const mapping = {};
    let ok = true;
    fields.forEach(f => {
      const v = selects[f.key].value;
      mapping[f.key] = v === '' ? null : parseInt(v, 10);
      if (f.required && mapping[f.key] === null) ok = false;
    });
    if (!ok) { toast('Faltan columnas obligatorias por mapear.'); return; }
    onConfirm(mapping);
    container.innerHTML = '<p class="muted">Importación aplicada.</p>';
  };
  container.appendChild(btn);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============ Tabs ============ */

const TAB_STORAGE_KEY = 'nunu_active_tab';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    localStorage.setItem(TAB_STORAGE_KEY, btn.dataset.tab);
    if (btn.dataset.tab === 'traspasos') adjustRepoTableScrollHeight();
  });
});

// Vuelve a la última pestaña abierta al recargar la página, en vez de
// empezar siempre en "Catálogo".
function restoreActiveTab() {
  const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
  if (!savedTab) return;
  const btn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
  if (btn) btn.click();
}

/* ============ Reglas SKU: derivación ============ */

function normalizeSku(s) {
  return (s ?? '').toString().trim().toUpperCase();
}

function normMaterial(raw) {
  if (!raw) return null;
  const s = raw.toString().trim().toUpperCase();
  if (state.catalogRules.aliasOro.includes(s)) return 'ORO';
  if (state.catalogRules.aliasRodio.includes(s)) return 'RODIO';
  if (/^OR|GOLD|DORAD/.test(s)) return 'ORO';
  if (/^RO|RHOD|PLATA/.test(s)) return 'RODIO';
  return null;
}

// Interpreta un código (con o sin prefijo "WH-") en sus tres componentes:
// base, talla y material — sin asumir ningún orden fijo entre talla y
// material, porque en los datos reales aparecen en cualquier orden
// ("BRI517-L-ORO" vs "BRI572-ORO-M") y el oro a veces ni se indica.
function parseVariantCode(rawCode, stripWhPrefix) {
  let code = normalizeSku(rawCode);
  if (stripWhPrefix) {
    const prefix = normalizeSku(state.catalogRules.whPrefix);
    if (code.startsWith(prefix)) code = code.slice(prefix.length);
  }
  const parts = code.split('-').filter(Boolean);
  if (!parts.length) return { base: '', talla: '', material: null };
  const base = parts[0];
  const modifiers = parts.slice(1);
  let material = null;
  const tallaParts = [];
  modifiers.forEach(tok => {
    const mat = normMaterial(tok);
    if (mat && !material) material = mat;
    else tallaParts.push(tok);
  });
  return { base, talla: tallaParts.join('-'), material };
}

// Clave de comparación entre Wholesale y tiendas: mismo producto = misma
// base + misma talla + mismo material (asumiendo oro cuando no se indica,
// igual en los dos lados, según tu regla de negocio).
function matchKeyFor(base, talla, material) {
  return normalizeSku(base) + '|' + normalizeSku(talla) + '|' + (material || state.catalogRules.materialDefault);
}

// Mira si ya existen referencias de esta misma base en el catálogo y en qué
// orden ponían la talla y el material, para proponer un SKU nuevo coherente
// con el resto de esa familia de productos en vez de un orden fijo genérico.
function detectVariantOrder(base) {
  const prefix = normalizeSku(state.catalogRules.whPrefix);
  for (const c of state.catalog) {
    if (c.base !== base || !c.talla || !c.material) continue;
    let code = normalizeSku(c.whSku);
    if (code.startsWith(prefix)) code = code.slice(prefix.length);
    const parts = code.split('-').filter(Boolean).slice(1);
    const matIdx = parts.findIndex(p => normMaterial(p) === c.material);
    const tallaIdx = parts.findIndex(p => p === c.talla.split('-')[0]);
    if (matIdx === -1 || tallaIdx === -1) continue;
    return matIdx < tallaIdx ? 'material-talla' : 'talla-material';
  }
  return null;
}

function suggestWhSku(base, talla, material) {
  const mat = material || state.catalogRules.materialDefault;
  const order = detectVariantOrder(base) || 'talla-material';
  const tokens = [base];
  if (order === 'material-talla') {
    tokens.push(mat);
    if (talla) tokens.push(talla);
  } else {
    if (talla) tokens.push(talla);
    tokens.push(mat);
  }
  return normalizeSku(state.catalogRules.whPrefix) + tokens.join('-');
}

/* ============ Catálogo ============ */

function renderCatalogTable() {
  const tbody = document.querySelector('#tableCatalog tbody');
  const filterVal = (document.getElementById('catalogFilter').value || '').toLowerCase();
  tbody.innerHTML = '';
  const rows = state.catalog.filter(r =>
    !filterVal || r.searchText.includes(filterVal) || r.whSku.toLowerCase().includes(filterVal)
  );
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.base}</td><td>${r.nombre}</td><td>${r.talla || '—'}</td><td>${r.material || '(por defecto: ' + state.catalogRules.materialDefault + ')'}</td><td>${r.whSku}</td><td>${r.variante || ''}</td><td>${r.precio ? r.precio.toFixed(2) + ' €' : '—'}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('catalogCount').textContent = state.catalog.length;
}

document.getElementById('inputCatalog').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFileAsText(file);
  const { headers, rows } = parseCSV(text);
  const container = document.getElementById('mappingCatalog');
  const fields = [
    { key: 'whSkuCol', label: 'SKU Wholesale', required: true, guess: '^sku$|codigo|wholesale' },
    { key: 'nombre', label: 'Nombre del producto', required: true, guess: 'product|nombre|descrip|name' },
    { key: 'variante', label: 'Variante (talla/color, texto libre — ayuda al buscador)', required: false, guess: 'variant|talla|size|color' },
    { key: 'stockCol', label: 'Stock Wholesale actual (si este mismo archivo también lo trae)', required: false, guess: 'available|stock|existenc' },
    { key: 'precioCol', label: 'Precio unitario (opcional, para la factura)', required: false, guess: 'precio|price|pvp' },
  ];
  renderMapping(container, headers, fields, (mapping) => {
    let added = 0, updated = 0, stockImported = 0;
    const freshStock = mapping.stockCol !== null ? {} : null;

    rows.forEach(r => {
      const whSku = normalizeSku(r[mapping.whSkuCol]);
      if (!whSku) return;
      const nombre = mapping.nombre !== null ? r[mapping.nombre] : '';
      if (!nombre) return;
      const variante = mapping.variante !== null ? r[mapping.variante] : '';

      const existingIdx = state.catalog.findIndex(c => c.whSku === whSku);
      let precio = mapping.precioCol !== null ? parseFloat(String(r[mapping.precioCol]).replace(',', '.')) : NaN;
      if (isNaN(precio)) precio = existingIdx >= 0 ? (state.catalog[existingIdx].precio || 0) : 0;

      const parsed = parseVariantCode(whSku, true);
      const matchKey = matchKeyFor(parsed.base, parsed.talla, parsed.material);
      const searchText = [nombre, variante, parsed.talla, parsed.material, parsed.base].filter(Boolean).join(' ').toLowerCase();
      const entry = { base: parsed.base, talla: parsed.talla, material: parsed.material, matchKey, nombre, variante, whSku, searchText, precio };

      if (existingIdx >= 0) { state.catalog[existingIdx] = entry; updated++; }
      else { state.catalog.push(entry); added++; }

      if (freshStock) {
        const qty = parseInt(r[mapping.stockCol], 10);
        if (!isNaN(qty)) { freshStock[whSku] = qty; stockImported++; }
      }
    });

    if (freshStock) state.stockWholesale = freshStock;
    saveState();
    renderCatalogTable();
    renderStockWholesaleSummary();
    let msg = `Catálogo: ${added} nuevas, ${updated} actualizadas.`;
    if (freshStock) msg += ` Stock Wholesale: ${stockImported} refs (sustituye al anterior).`;
    toast(msg);
  });
});

document.getElementById('catalogFilter').addEventListener('input', renderCatalogTable);

/* ============ Stock Wholesale ============ */

function renderStockWholesaleSummary() {
  document.getElementById('stockWholesaleCount').textContent = Object.keys(state.stockWholesale).length;
}

document.getElementById('inputStockWholesale').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFileAsText(file);
  const { headers, rows } = parseCSV(text);
  const container = document.getElementById('mappingStockWholesale');
  const fields = [
    { key: 'sku', label: 'SKU Wholesale', required: true, guess: 'sku' },
    { key: 'qty', label: 'Cantidad / Stock', required: true, guess: 'qty|cantidad|stock' },
  ];
  renderMapping(container, headers, fields, (mapping) => {
    const fresh = {};
    let n = 0;
    rows.forEach(r => {
      const sku = normalizeSku(r[mapping.sku]);
      const qty = parseInt(r[mapping.qty], 10);
      if (!sku || isNaN(qty)) return;
      fresh[sku] = qty;
      n++;
    });
    state.stockWholesale = fresh;
    saveState();
    renderStockWholesaleSummary();
    toast(`Stock Wholesale: ${n} referencias importadas (sustituye al stock anterior).`);
  });
});

/* ============ Stock y ventas por tienda ============ */

function renderStoreStockSummary() {
  const el = document.getElementById('storeStockSummary');
  el.innerHTML = STORES.map(s => {
    const vals = Object.values(state.storeStock[s]);
    const units = vals.reduce((a, b) => a + (b.qty || 0), 0);
    return `<div class="chip">${STORE_LABELS[s]}<b>${vals.length} refs · ${units} uds</b></div>`;
  }).join('');
}

function renderStoreSalesSummary() {
  document.getElementById('salesWindowLabel1').textContent = state.config.salesWindowDays;
  const el = document.getElementById('storeSalesSummary');
  el.innerHTML = STORES.map(s => {
    const vals = Object.values(state.storeSales[s]);
    const units = vals.reduce((a, b) => a + (b.qty || 0), 0);
    return `<div class="chip">${STORE_LABELS[s]}<b>${vals.length} refs · ${units} uds vendidas</b></div>`;
  }).join('');
}

// Índice de todo lo visto en tiendas (tenga o no ya un SKU Wholesale en el
// catálogo), para que el buscador pueda encontrar piezas que solo existen en
// retail todavía. Se recalcula al vuelo en cada búsqueda (no se persiste)
// para que nunca quede desactualizado respecto al stock/ventas importados.
function buildRetailIndex() {
  const idx = {};
  STORES.forEach(s => {
    [state.storeStock[s], state.storeSales[s]].forEach(map => {
      Object.entries(map).forEach(([matchKey, entry]) => {
        if (!idx[matchKey]) {
          const [base, talla, material] = matchKey.split('|');
          idx[matchKey] = { base, talla, material, nombre: entry.nombre || '' };
        } else if (!idx[matchKey].nombre && entry.nombre) {
          idx[matchKey].nombre = entry.nombre;
        }
      });
    });
  });
  Object.values(idx).forEach(e => {
    e.searchText = [e.nombre, e.base, e.talla, e.material].filter(Boolean).join(' ').toLowerCase();
  });
  return idx;
}

document.getElementById('inputStoreStock').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const store = document.getElementById('selectStoreForStock').value;
  const text = await readFileAsText(file);
  const { headers, rows } = parseCSV(text);
  const container = document.getElementById('mappingStoreStock');
  const fields = [
    { key: 'sku', label: 'SKU Retail', required: true, guess: 'sku' },
    { key: 'nombre', label: 'Nombre del producto (opcional, mejora el buscador)', required: false, guess: 'product|nombre|descrip|name' },
    { key: 'stock', label: 'Stock actual', required: false, guess: 'available|stock|existenc' },
    { key: 'ventasQty', label: 'Cantidad vendida (ventana de días de abajo)', required: false, guess: '^sales$|ventas ?1m|ventas ?30|vendid' },
    { key: 'fecha', label: 'Fecha de venta (solo si el stock/ventas viene con histórico línea a línea)', required: false, guess: 'fecha|date' },
  ];
  renderMapping(container, headers, fields, (mapping) => {
    if (mapping.stock === null && mapping.ventasQty === null) {
      toast('Mapea al menos la columna de stock o la de ventas.');
      return;
    }
    const windowMs = state.config.salesWindowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const freshStock = {};
    const freshSales = {};
    let nStock = 0, nSales = 0;

    rows.forEach(r => {
      const rawSku = r[mapping.sku];
      if (!rawSku) return;
      const sku = normalizeSku(rawSku);
      const nombre = mapping.nombre !== null ? r[mapping.nombre] : '';
      const parsed = parseVariantCode(rawSku, false);
      const matchKey = matchKeyFor(parsed.base, parsed.talla, parsed.material);

      if (mapping.stock !== null) {
        const qty = parseInt(r[mapping.stock], 10);
        if (!isNaN(qty)) {
          if (freshStock[matchKey]) freshStock[matchKey].qty += qty;
          else freshStock[matchKey] = { rawSku: sku, qty, nombre };
          nStock++;
        }
      }
      if (mapping.ventasQty !== null) {
        const qty = parseInt(r[mapping.ventasQty], 10);
        if (!isNaN(qty)) {
          if (mapping.fecha !== null) {
            const d = new Date(r[mapping.fecha]);
            if (isNaN(d.getTime()) || now - d.getTime() > windowMs) return;
          }
          if (freshSales[matchKey]) freshSales[matchKey].qty += qty;
          else freshSales[matchKey] = { rawSku: sku, qty, nombre };
          nSales++;
        }
      }
    });

    if (mapping.stock !== null) state.storeStock[store] = freshStock;
    if (mapping.ventasQty !== null) state.storeSales[store] = freshSales;
    saveState();
    renderStoreStockSummary();
    renderStoreSalesSummary();
    toast(`${STORE_LABELS[store]}: ${nStock} refs de stock, ${nSales} líneas de venta importadas (sustituyen a los datos anteriores).`);
  });
});

/* ============ Buscador y Pedido ============ */

function scoreCatalogRow(row, tokens) {
  const rowWords = row.searchText.split(/\s+/);
  const numeric = tokens.filter(t => t && /^\d+$/.test(t));
  const nonNumeric = tokens.filter(t => t && !/^\d+$/.test(t));

  // Talla es un filtro duro: si se pide una talla numérica concreta y la
  // referencia tiene una talla distinta (o ninguna), se descarta entera.
  for (const t of numeric) {
    if (!row.talla || row.talla.toString().toLowerCase() !== t) return 0;
  }

  let wordMatches = 0, weakMatches = 0;
  for (const t of nonNumeric) {
    if (rowWords.includes(t)) wordMatches++;
    else if (row.searchText.includes(t)) weakMatches++;
  }

  // Exige que casi todas las palabras (todas si la búsqueda es corta) tengan
  // alguna coincidencia, para no devolver referencias solo vagamente relacionadas.
  const minRequired = nonNumeric.length <= 2 ? nonNumeric.length : nonNumeric.length - 1;
  if (nonNumeric.length > 0 && (wordMatches + weakMatches) < minRequired) return 0;

  return wordMatches * 2 + weakMatches + numeric.length * 3;
}

function renderSearchResults(catalogMatches, retailMatches) {
  const el = document.getElementById('searchResults');
  if (!catalogMatches.length && !retailMatches.length) { el.innerHTML = '<p class="muted">Sin resultados.</p>'; return; }
  el.innerHTML = '';

  catalogMatches.forEach(row => {
    const div = document.createElement('div');
    div.className = 'search-result-row';
    div.innerHTML = `
      <div>
        <strong>${row.whSku}</strong> — ${row.nombre} ${row.talla ? '· talla ' + row.talla : ''} ${row.material ? '· ' + row.material : ''}
        <div class="meta">Se buscará en tiendas por: base "${row.base}", talla "${row.talla || '—'}", material ${row.material || state.catalogRules.materialDefault + ' (por defecto)'}</div>
      </div>
      <div class="actions">
        <input type="number" min="1" value="1" class="qtyInput">
        <button class="btn-small">Añadir al pedido</button>
      </div>`;
    div.querySelector('.btn-small').addEventListener('click', () => {
      const qty = parseInt(div.querySelector('.qtyInput').value, 10) || 1;
      addToPedido(row.whSku, row.nombre, qty, row.precio);
    });
    el.appendChild(div);
  });

  retailMatches.forEach(({ matchKey, entry }) => {
    const skuSugerido = suggestWhSku(entry.base, entry.talla, entry.material);
    const div = document.createElement('div');
    div.className = 'search-result-row';
    div.innerHTML = `
      <div>
        <strong>${entry.nombre || entry.base}</strong> ${entry.talla ? '· talla ' + entry.talla : ''} ${entry.material ? '· ' + entry.material : ''}
        <span class="badge badge-warn">Sin SKU Wholesale en el catálogo</span>
        <div class="meta">Visto en tienda con base "${entry.base}". SKU Wholesale que se propondrá: <strong>${skuSugerido}</strong></div>
      </div>
      <div class="actions">
        <input type="number" min="1" value="1" class="qtyInput">
        <button class="btn-small">Añadir de todas formas</button>
      </div>`;
    div.querySelector('.btn-small').addEventListener('click', () => {
      const qty = parseInt(div.querySelector('.qtyInput').value, 10) || 1;
      addToPedidoNuevo(matchKey, entry, qty);
    });
    el.appendChild(div);
  });
}

document.getElementById('btnSearch').addEventListener('click', () => {
  const q = document.getElementById('searchQuery').value.toLowerCase().trim();
  if (!q) { renderSearchResults([], []); return; }
  const tokens = q.split(/\s+/);

  const catalogMatchKeys = new Set(state.catalog.map(c => c.matchKey));
  const catalogMatches = state.catalog
    .map(row => ({ row, score: scoreCatalogRow(row, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => x.row);

  const retailMatches = Object.entries(buildRetailIndex())
    .filter(([matchKey]) => !catalogMatchKeys.has(matchKey))
    .map(([matchKey, entry]) => ({ matchKey, entry, score: scoreCatalogRow(entry, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ matchKey, entry }) => ({ matchKey, entry }));

  renderSearchResults(catalogMatches, retailMatches);
});
document.getElementById('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSearch').click();
});

function addToPedido(whSku, nombre, qty, precio) {
  whSku = normalizeSku(whSku);
  const existing = state.pedido.find(p => p.whSku === whSku && !p.pendienteCatalogo);
  if (existing) existing.cantidad += qty;
  else state.pedido.push({ whSku, nombre, cantidad: qty, precio: precio || 0 });
  saveState();
  renderPedidoTable();
  toast(`Añadido al pedido: ${whSku} x${qty}`);
}

// Añade al pedido una pieza que solo existe en el stock de alguna tienda,
// sin SKU Wholesale todavía en el catálogo. El traspaso se calcula igual
// (usando base+talla+material directamente) y se avisa de que hay que dar
// de alta el SKU sugerido en Wholesale cuando se apruebe.
function addToPedidoNuevo(matchKey, entry, qty) {
  const skuSugerido = suggestWhSku(entry.base, entry.talla, entry.material);
  const existing = state.pedido.find(p => p.pendienteCatalogo && p.matchKey === matchKey);
  if (existing) {
    existing.cantidad += qty;
  } else {
    state.pedido.push({
      whSku: skuSugerido,
      nombre: entry.nombre || `${entry.base}${entry.talla ? ' ' + entry.talla : ''}`,
      cantidad: qty,
      precio: 0,
      pendienteCatalogo: true,
      base: entry.base,
      talla: entry.talla,
      material: entry.material === state.catalogRules.materialDefault ? null : entry.material,
      matchKey,
    });
  }
  saveState();
  renderPedidoTable();
  toast(`Añadido sin SKU Wholesale todavía. Propuesta para crearlo en el catálogo: "${skuSugerido}". El traspaso se calculará igual mientras tanto.`);
}

// Se ordena alfabéticamente (A-Z por nombre) en vez de por orden de
// incorporación, recalculando el orden cada vez que cambia el pedido; el
// índice original (idx) se conserva para que editar/quitar sigan operando
// sobre la posición real en state.pedido.
function sortByNombre(items, getNombre) {
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (getNombre(a.item) || '').localeCompare(getNombre(b.item) || '', 'es', { sensitivity: 'base' }));
}

function renderPedidoTable() {
  const tbody = document.querySelector('#tablePedido tbody');
  tbody.innerHTML = '';
  sortByNombre(state.pedido, p => p.nombre).forEach(({ item: p, idx }) => {
    const tr = document.createElement('tr');
    const skuCell = p.pendienteCatalogo
      ? `${p.whSku} <span class="badge badge-warn">sugerido — falta crear en catálogo</span>`
      : p.whSku;
    const importe = (p.cantidad || 0) * (p.precio || 0);
    tr.innerHTML = `<td>${skuCell}</td><td>${p.nombre}</td>
      <td><input type="number" min="0" value="${p.cantidad}" class="pedidoQty" style="width:70px"></td>
      <td><input type="number" min="0" step="0.01" value="${p.precio || 0}" class="pedidoPrecio"> €</td>
      <td>${importe.toFixed(2)} €</td>
      <td><button class="btn-small">Quitar</button></td>`;
    tr.querySelector('.pedidoQty').addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      p.cantidad = isNaN(v) ? 0 : v;
      saveState();
      renderPedidoTable();
    });
    tr.querySelector('.pedidoPrecio').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      p.precio = isNaN(v) ? 0 : v;
      saveState();
      renderPedidoTable();
    });
    tr.querySelector('.btn-small').addEventListener('click', () => {
      state.pedido.splice(idx, 1);
      saveState();
      renderPedidoTable();
    });
    tbody.appendChild(tr);
  });
  document.getElementById('pedidoEmpty').style.display = state.pedido.length ? 'none' : 'block';
  renderFactura();
}

document.getElementById('inputPedido').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFileAsText(file);
  const { headers, rows } = parseCSV(text);
  const container = document.getElementById('mappingPedido');
  const fields = [
    { key: 'sku', label: 'SKU Wholesale', required: true, guess: 'sku' },
    { key: 'qty', label: 'Cantidad pedida', required: true, guess: 'qty|cantidad' },
    { key: 'precio', label: 'Precio unitario (opcional, si no lo tienes en catálogo)', required: false, guess: 'precio|price|pvp' },
  ];
  renderMapping(container, headers, fields, (mapping) => {
    let n = 0;
    rows.forEach(r => {
      const sku = normalizeSku(r[mapping.sku]);
      const qty = parseInt(r[mapping.qty], 10);
      if (!sku || isNaN(qty)) return;
      const catRow = state.catalog.find(c => c.whSku === sku);
      let precio = mapping.precio !== null ? parseFloat(String(r[mapping.precio]).replace(',', '.')) : NaN;
      if (isNaN(precio)) precio = catRow ? (catRow.precio || 0) : 0;
      addToPedidoSilent(sku, catRow ? catRow.nombre : sku, qty, precio);
      n++;
    });
    saveState();
    renderPedidoTable();
    toast(`Pedido: ${n} líneas importadas/combinadas.`);
  });
});

function addToPedidoSilent(whSku, nombre, qty, precio) {
  whSku = normalizeSku(whSku);
  const existing = state.pedido.find(p => p.whSku === whSku && !p.pendienteCatalogo);
  if (existing) existing.cantidad += qty;
  else state.pedido.push({ whSku, nombre, cantidad: qty, precio: precio || 0 });
}

/* ============ Pedidos guardados ============ */

function activePedidoRecord() {
  if (!state.pedidoActualId) return null;
  return state.pedidos.find(p => p.id === state.pedidoActualId) || null;
}

function genId() {
  return 'pedido_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function crearPedidoGuardado(titulo, cliente) {
  const id = genId();
  const now = new Date().toISOString();
  state.pedidos.push({
    id, titulo: titulo || 'Sin título', cliente: cliente || '',
    clienteTipo: 'nacional', clienteNif: '', clienteDireccion: '',
    facturaNumero: null, facturaFecha: null,
    creadoEn: now, actualizadoEn: now,
    pedido: state.pedido, dashboard: state.dashboard,
  });
  state.pedidoActualId = id;
  saveState();
  renderActivePedidoBanner();
  renderPedidosTab();
  renderFactura();
  toast(`Pedido "${titulo || 'Sin título'}" guardado.`);
}

function guardarComoNuevoPedido(titulo, cliente) {
  const id = genId();
  const now = new Date().toISOString();
  state.pedidos.push({
    id, titulo: titulo || 'Sin título', cliente: cliente || '',
    clienteTipo: 'nacional', clienteNif: '', clienteDireccion: '',
    facturaNumero: null, facturaFecha: null,
    creadoEn: now, actualizadoEn: now,
    pedido: JSON.parse(JSON.stringify(state.pedido)),
    dashboard: JSON.parse(JSON.stringify(state.dashboard)),
  });
  state.pedidoActualId = id;
  saveState();
  renderActivePedidoBanner();
  renderPedidosTab();
  renderFactura();
  toast(`Duplicado como nuevo pedido "${titulo || 'Sin título'}".`);
}

function abrirPedido(id) {
  const rec = state.pedidos.find(p => p.id === id);
  if (!rec) return;
  state.pedido = JSON.parse(JSON.stringify(rec.pedido || []));
  state.dashboard = JSON.parse(JSON.stringify(rec.dashboard || []));
  state.pedidoActualId = id;
  saveState();
  renderPedidoTable();
  renderDashboard();
  renderActivePedidoBanner();
  document.querySelector('.tab-btn[data-tab="pedido"]').click();
  toast(`Abierto: "${rec.titulo}".`);
}

function eliminarPedido(id) {
  const rec = state.pedidos.find(p => p.id === id);
  if (!rec) return;
  if (!confirm(`¿Eliminar el pedido guardado "${rec.titulo}"? Esta acción no se puede deshacer.`)) return;
  state.pedidos = state.pedidos.filter(p => p.id !== id);
  if (state.pedidoActualId === id) nuevoPedidoEnBlanco(false);
  saveState();
  renderPedidosTab();
  renderActivePedidoBanner();
  renderFactura();
  toast('Pedido eliminado.');
}

function nuevoPedidoEnBlanco(showToast) {
  state.pedido = [];
  state.dashboard = [];
  state.pedidoActualId = null;
  saveState();
  renderPedidoTable();
  renderDashboard();
  renderActivePedidoBanner();
  if (showToast !== false) toast('Pedido en blanco listo para trabajar.');
}

function slugify(text) {
  return (text || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sin_titulo';
}

function renderActivePedidoBanner() {
  const el = document.getElementById('activePedidoBanner');
  if (!el) return;
  const rec = activePedidoRecord();
  if (!rec) {
    el.innerHTML = `
      <div class="inline-fields">
        <input type="text" id="nuevoPedidoTitulo" placeholder="Título del pedido (p. ej. Pedido Julio - Cliente X)">
        <input type="text" id="nuevoPedidoCliente" placeholder="Cliente (opcional)">
        <button id="btnGuardarPedidoNuevo" class="btn-primary">Guardar este pedido</button>
      </div>
      <p class="hint">Este pedido todavía no está guardado — es un borrador. Ponle un título para poder guardarlo, retomarlo más tarde y llevar el traspaso de cada pedido por separado.</p>`;
    document.getElementById('btnGuardarPedidoNuevo').addEventListener('click', () => {
      const titulo = document.getElementById('nuevoPedidoTitulo').value.trim();
      const cliente = document.getElementById('nuevoPedidoCliente').value.trim();
      if (!titulo) { toast('Ponle un título al pedido antes de guardarlo.'); return; }
      crearPedidoGuardado(titulo, cliente);
    });
  } else {
    el.innerHTML = `
      <div class="card-header">
        <h3>Pedido: ${rec.titulo} ${rec.cliente ? '· Cliente: ' + rec.cliente : ''}</h3>
        <div class="inline-fields" style="margin-bottom:0">
          <button id="btnRenombrarPedido" class="btn-small">Editar título/cliente</button>
          <button id="btnDuplicarPedido" class="btn-small">Guardar como nuevo</button>
          <button id="btnNuevoPedido" class="btn-small">Nuevo pedido en blanco</button>
        </div>
      </div>
      <p class="muted">Autoguardado · última actualización ${new Date(rec.actualizadoEn).toLocaleString('es-ES')}</p>`;
    document.getElementById('btnNuevoPedido').addEventListener('click', () => nuevoPedidoEnBlanco());
    document.getElementById('btnDuplicarPedido').addEventListener('click', () => {
      const titulo = prompt('Título para el pedido duplicado:', rec.titulo + ' (copia)');
      if (titulo === null) return;
      const cliente = prompt('Cliente (opcional):', rec.cliente || '') || '';
      guardarComoNuevoPedido(titulo.trim() || 'Sin título', cliente.trim());
    });
    document.getElementById('btnRenombrarPedido').addEventListener('click', () => {
      const titulo = prompt('Título del pedido:', rec.titulo);
      if (titulo === null) return;
      const cliente = prompt('Cliente (opcional):', rec.cliente || '');
      if (cliente === null) return;
      rec.titulo = titulo.trim() || 'Sin título';
      rec.cliente = cliente.trim();
      saveState();
      renderActivePedidoBanner();
      renderPedidosTab();
    });
  }
}

function renderPedidosTab() {
  const tbody = document.querySelector('#tablePedidos tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const sorted = [...state.pedidos].sort((a, b) => new Date(b.actualizadoEn) - new Date(a.actualizadoEn));
  sorted.forEach(rec => {
    const tr = document.createElement('tr');
    const isActive = rec.id === state.pedidoActualId;
    const pendientesAprobar = (rec.dashboard || []).filter(r =>
      (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad') && !r.aprobado
    ).length;
    tr.innerHTML = `
      <td>${rec.titulo}${isActive ? ' <span class="badge badge-ok">abierto</span>' : ''}</td>
      <td>${rec.cliente || '—'}</td>
      <td>${(rec.pedido || []).length}</td>
      <td>${pendientesAprobar || '—'}</td>
      <td>${new Date(rec.actualizadoEn).toLocaleString('es-ES')}</td>
      <td>
        <button class="btn-small openBtn">Abrir</button>
        <button class="btn-small deleteBtn">Eliminar</button>
      </td>`;
    tr.querySelector('.openBtn').addEventListener('click', () => abrirPedido(rec.id));
    tr.querySelector('.deleteBtn').addEventListener('click', () => eliminarPedido(rec.id));
    tbody.appendChild(tr);
  });
  document.getElementById('pedidosEmpty').style.display = state.pedidos.length ? 'none' : 'block';
}

/* ============ Dashboard: cálculo de traspasos ============ */

function catalogRowByWhSku(whSku) {
  return state.catalog.find(c => c.whSku === whSku);
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function matchInfoLabel(catRow) {
  if (!catRow) return '(sin catálogo)';
  const mat = catRow.material || (state.catalogRules.materialDefault + ' (por defecto)');
  return `${catRow.base} · talla ${catRow.talla || '—'} · ${mat}`;
}

// Reparte un déficit entre tiendas según prioridad configurada. Se usa tanto
// para líneas normales (con catálogo) como para piezas sin SKU Wholesale
// todavía, que ya tienen matchKey propio calculado al añadirlas al pedido.
function allocateAcrossStores(matchKey, deficit) {
  const cfg = state.config;
  const porTienda = {};
  let ventasTotal = 0;
  STORES.forEach(s => {
    const stockEntry = state.storeStock[s][matchKey];
    const salesEntry = state.storeSales[s][matchKey];
    const stock = stockEntry ? stockEntry.qty : 0;
    const ventas = salesEntry ? salesEntry.qty : 0;
    porTienda[s] = {
      existeStock: !!stockEntry, existeVentas: !!salesEntry, stock, ventas,
      rawSku: (stockEntry && stockEntry.rawSku) || (salesEntry && salesEntry.rawSku) || null,
    };
    ventasTotal += ventas;
  });

  let priorityOrder;
  if (cfg.secondaryCriterion === 'stock_desc') {
    priorityOrder = STORES.filter(s => s !== 'AMIGO')
      .sort((a, b) => porTienda[b].stock - porTienda[a].stock);
  } else {
    priorityOrder = STORES.filter(s => s !== 'AMIGO')
      .sort((a, b) => porTienda[a].ventas - porTienda[b].ventas);
  }
  priorityOrder = ['AMIGO', ...priorityOrder];

  const asignaciones = {};
  let restante = deficit;
  let leavesZero = false;

  priorityOrder.forEach(s => {
    if (restante <= 0) return;
    const disponible = porTienda[s].stock;
    if (disponible <= 0) return;
    const take = Math.min(disponible, restante);
    if (take <= 0) return;
    asignaciones[s] = take;
    restante -= take;
    if (cfg.warnLastUnit && (disponible - take) === 0) leavesZero = true;
  });

  let estado = 'auto_sugerido';
  if (ventasTotal > cfg.salesThreshold) estado = 'pendiente_ventas';
  else if (leavesZero) estado = 'pendiente_ultima_unidad';

  return { porTienda, ventasTotal, asignaciones, restante, estado };
}

function computeDashboard() {
  const result = [];

  state.pedido.forEach(p => {
    if (!p.cantidad || p.cantidad <= 0) return;

    if (p.pendienteCatalogo) {
      const deficit = p.cantidad; // no existe en Wholesale todavía, se necesita todo del stock de tiendas
      const alloc = allocateAcrossStores(p.matchKey, deficit);
      result.push({
        whSku: p.whSku, nombre: p.nombre, pedido: p.cantidad, stockWh: 0, deficit,
        matchInfo: `${p.base} · talla ${p.talla || '—'} · ${p.material || state.catalogRules.materialDefault + ' (por defecto)'}`,
        matchKey: p.matchKey, ventas30: alloc.ventasTotal, estado: alloc.estado,
        asignaciones: alloc.asignaciones, aprobado: alloc.estado === 'auto_sugerido',
        sinAbastecer: alloc.restante, pendienteCatalogo: true, skuSugerido: p.whSku,
        diagnostico: { whSkuBuscado: p.whSku, stockWhEncontrado: false, catRow: null, porTienda: alloc.porTienda },
      });
      return;
    }

    const whSkuBuscado = normalizeSku(p.whSku);
    const stockWhEncontrado = hasKey(state.stockWholesale, whSkuBuscado);
    const stockWh = stockWhEncontrado ? state.stockWholesale[whSkuBuscado] : 0;
    const deficit = Math.max(0, p.cantidad - stockWh);
    const catRow = catalogRowByWhSku(whSkuBuscado);
    const matchKey = catRow ? catRow.matchKey : null;

    if (deficit <= 0 || !matchKey) {
      result.push({
        whSku: p.whSku, nombre: p.nombre, pedido: p.cantidad, stockWh, deficit,
        matchInfo: matchInfoLabel(catRow), matchKey: null, ventas30: 0,
        estado: deficit <= 0 ? 'cubierto_wholesale' : 'sin_sku_retail',
        asignaciones: {}, aprobado: true,
        diagnostico: { whSkuBuscado, stockWhEncontrado, catRow, porTienda: null },
      });
      return;
    }

    const alloc = allocateAcrossStores(matchKey, deficit);
    result.push({
      whSku: p.whSku, nombre: p.nombre, pedido: p.cantidad, stockWh, deficit,
      matchInfo: matchInfoLabel(catRow), matchKey, ventas30: alloc.ventasTotal, estado: alloc.estado,
      asignaciones: alloc.asignaciones,
      aprobado: alloc.estado === 'auto_sugerido',
      sinAbastecer: alloc.restante,
      diagnostico: { whSkuBuscado, stockWhEncontrado, catRow, porTienda: alloc.porTienda },
    });
  });

  state.dashboard = result;
  saveState();
}

function estadoBadge(estado) {
  const map = {
    cubierto_wholesale: ['badge-muted', 'Cubierto por stock Wholesale'],
    sin_sku_retail: ['badge-danger', 'Sin equivalencia en catálogo'],
    auto_sugerido: ['badge-ok', 'Sugerido automático'],
    pendiente_ventas: ['badge-warn', 'Pendiente aprobación (ventas > umbral)'],
    pendiente_ultima_unidad: ['badge-warn', 'Pendiente aprobación (última unidad)'],
  };
  const [cls, label] = map[estado] || ['badge-muted', estado];
  return `<span class="badge ${cls}">${label}</span>`;
}

function diagnosticoHtml(row) {
  const d = row.diagnostico;
  if (!d) return '<p class="muted">Sin datos de diagnóstico.</p>';

  if (row.pendienteCatalogo) {
    let html = `<p><span class="badge badge-warn">Pieza añadida desde tienda, sin SKU Wholesale creado todavía</span> — SKU propuesto para darla de alta: <strong>"${row.skuSugerido}"</strong>.</p>`;
    html += `<p><strong>Interpretado como:</strong> ${row.matchInfo}</p>`;
    if (d.porTienda) {
      const rows = STORES.map(s => {
        const t = d.porTienda[s];
        return `<tr><td>${STORE_LABELS[s]}</td>
          <td>${t.existeStock ? `sí (SKU "${t.rawSku}")` : '<span class="badge badge-danger">ninguna referencia coincide en esta tienda</span>'}</td><td>${t.stock}</td>
          <td>${t.existeVentas ? 'sí' : '<span class="badge badge-muted">no</span>'}</td><td>${t.ventas}</td></tr>`;
      }).join('');
      html += `<div class="table-scroll"><table><thead><tr>
        <th>Tienda</th><th>¿Coincide base+talla+material en stock?</th><th>Stock</th><th>¿Coincide en ventas?</th><th>Ventas</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    return html;
  }

  let html = `<p><strong>SKU Wholesale buscado:</strong> "${d.whSkuBuscado}" — `;
  html += d.stockWhEncontrado
    ? `encontrado en el import de stock Wholesale (valor: ${row.stockWh}).`
    : `<span class="badge badge-danger">no existe esa clave exacta en el import de stock Wholesale</span> (se asume 0).`;
  html += '</p>';

  if (!d.catRow) {
    html += `<p><span class="badge badge-danger">No hay ninguna referencia en el catálogo cuyo SKU Wholesale sea exactamente "${d.whSkuBuscado}"</span>. Revisa que el catálogo tenga esa referencia y que el texto coincida letra por letra (mayúsculas y guiones incluidos).</p>`;
  } else {
    const c = d.catRow;
    html += `<p><strong>Interpretado como:</strong> base "${c.base}", talla "${c.talla || '—'}", material ${c.material || state.catalogRules.materialDefault + ' (por defecto, no venía indicado en el SKU)'}</p>`;
    if (d.porTienda) {
      const rows = STORES.map(s => {
        const t = d.porTienda[s];
        return `<tr><td>${STORE_LABELS[s]}</td>
          <td>${t.existeStock ? `sí (SKU "${t.rawSku}")` : '<span class="badge badge-danger">ninguna referencia coincide en esta tienda</span>'}</td><td>${t.stock}</td>
          <td>${t.existeVentas ? 'sí' : '<span class="badge badge-muted">no</span>'}</td><td>${t.ventas}</td></tr>`;
      }).join('');
      html += `<div class="table-scroll"><table><thead><tr>
        <th>Tienda</th><th>¿Coincide base+talla+material en stock?</th><th>Stock</th><th>¿Coincide en ventas?</th><th>Ventas</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
      html += `<p class="hint">Si una tienda no coincide, revisa cómo escribe esa tienda la talla o el material en su propio SKU (puede que use letras distintas, p. ej. "PL" en vez de "RO") y ajusta los alias de material en Reglas/Config.</p>`;
    }
  }
  return html;
}

function renderDashboard() {
  const tbody = document.querySelector('#tableDashboard tbody');
  tbody.innerHTML = '';

  sortByNombre(state.dashboard, r => r.nombre).forEach(({ item: row, idx }) => {
    const tr = document.createElement('tr');
    const tds = [];
    const skuCell = row.pendienteCatalogo
      ? `${row.whSku} <span class="badge badge-warn" title="Todavía no existe en el catálogo Wholesale">sugerido</span>`
      : row.whSku;
    tds.push(`<td>${skuCell}</td>`);
    tds.push(`<td>${row.nombre}</td>`);
    tds.push(`<td>${row.pedido}</td>`);
    tds.push(`<td>${row.stockWh}</td>`);
    tds.push(`<td>${row.deficit}</td>`);
    tds.push(`<td>${row.matchInfo}</td>`);
    tds.push(`<td>${row.ventas30 ?? ''}</td>`);
    tds.push(`<td>${estadoBadge(row.estado)}</td>`);

    if (row.asignaciones && Object.keys(row.asignaciones).length) {
      const allocHtml = STORES.filter(s => row.asignaciones[s] !== undefined).map(s => {
        const entry = state.storeStock[s][row.matchKey];
        const disponible = entry ? entry.qty : 0;
        const cls = (disponible - row.asignaciones[s]) === 0 ? 'zero' : '';
        return `<div class="alloc-store ${cls}">
          <span>${STORE_LABELS[s]}${entry ? ' (' + entry.rawSku + ')' : ''}</span>
          <input type="number" min="0" max="${disponible}" value="${row.asignaciones[s]}" data-idx="${idx}" data-store="${s}" class="allocInput">
          <span class="muted">/ ${disponible} disp.</span>
        </div>`;
      }).join('');
      tds.push(`<td><div class="alloc-row">${allocHtml}</div>${row.sinAbastecer > 0 ? `<div class="badge badge-danger" style="margin-top:4px">Sin abastecer: ${row.sinAbastecer}</div>` : ''}</td>`);
    } else if (row.deficit > 0) {
      tds.push(`<td><span class="badge badge-danger">Sin abastecer: ${row.deficit}</span><div class="muted" style="margin-top:4px">Ninguna tienda tiene stock de esta referencia (o no se ha encontrado la clave — ver Detalle)</div></td>`);
    } else {
      tds.push(`<td>—</td>`);
    }

    if (row.estado === 'pendiente_ventas' || row.estado === 'pendiente_ultima_unidad') {
      tds.push(`<td><button class="btn-small approveBtn" data-idx="${idx}">${row.aprobado ? '✓ Aprobado' : 'Aprobar'}</button></td>`);
    } else {
      tds.push(`<td>—</td>`);
    }

    tds.push(`<td><button class="btn-small detailBtn" data-idx="${idx}">Ver detalle</button></td>`);

    tr.innerHTML = tds.join('');
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.className = 'detail-row';
    detailTr.style.display = 'none';
    const detailTd = document.createElement('td');
    detailTd.colSpan = 10;
    detailTd.innerHTML = diagnosticoHtml(row);
    detailTr.appendChild(detailTd);
    tbody.appendChild(detailTr);
  });

  tbody.querySelectorAll('.allocInput').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const store = e.target.dataset.store;
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      state.dashboard[idx].asignaciones[store] = v;
      const totalAsignado = Object.values(state.dashboard[idx].asignaciones).reduce((a, b) => a + b, 0);
      state.dashboard[idx].sinAbastecer = Math.max(0, state.dashboard[idx].deficit - totalAsignado);
      saveState();
      renderDashboard();
      renderDashboardSummary();
    });
  });
  tbody.querySelectorAll('.approveBtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.dashboard[idx].aprobado = !state.dashboard[idx].aprobado;
      saveState();
      renderDashboard();
    });
  });
  tbody.querySelectorAll('.detailBtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tr = e.target.closest('tr');
      const detailTr = tr.nextElementSibling;
      const showing = detailTr.style.display !== 'none';
      detailTr.style.display = showing ? 'none' : 'table-row';
      e.target.textContent = showing ? 'Ver detalle' : 'Ocultar detalle';
    });
  });

  renderDashboardSummary();
  renderAbastecidas();
}

function renderDashboardSummary() {
  const el = document.getElementById('dashboardSummary');
  const totalPedido = state.dashboard.reduce((a, r) => a + r.pedido, 0);
  const totalDeficit = state.dashboard.reduce((a, r) => a + r.deficit, 0);
  const totalAsignado = state.dashboard.reduce((a, r) => a + Object.values(r.asignaciones || {}).reduce((x, y) => x + y, 0), 0);
  const totalPendiente = state.dashboard.reduce((a, r) => a + (r.sinAbastecer || 0), 0);
  const pendientesAprobacion = state.dashboard.filter(r => !r.aprobado && (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad')).length;
  el.innerHTML = `
    <div class="store-summary">
      <div class="chip">Total pedido<b>${totalPedido}</b></div>
      <div class="chip">Déficit total vs Wholesale<b>${totalDeficit}</b></div>
      <div class="chip">Asignado desde tiendas<b>${totalAsignado}</b></div>
      <div class="chip">Sin abastecer<b>${totalPendiente}</b></div>
      <div class="chip">Líneas pendientes de aprobar<b>${pendientesAprobacion}</b></div>
    </div>`;
}

document.getElementById('btnCalcular').addEventListener('click', () => {
  if (!state.pedido.length) { toast('No hay pedido cargado.'); return; }
  computeDashboard();
  renderDashboard();
  document.getElementById('calcInfo').textContent = `Calculado a las ${new Date().toLocaleTimeString('es-ES')}`;
});

document.getElementById('btnGenerarCSVs').addEventListener('click', () => {
  const pendientesSinAprobar = state.dashboard.filter(r =>
    (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad') && !r.aprobado
  );
  if (pendientesSinAprobar.length) {
    toast(`Hay ${pendientesSinAprobar.length} líneas pendientes de aprobar. Apruébalas o su cantidad no se incluirá.`);
  }

  const byStore = { AMIGO: {}, MADRID: {}, RAMBLA: {}, VALENCIA: {} };
  state.dashboard.forEach(r => {
    if (!r.asignaciones) return;
    const bloqueada = (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad') && !r.aprobado;
    if (bloqueada) return;
    Object.entries(r.asignaciones).forEach(([store, qty]) => {
      if (qty > 0) {
        const entry = state.storeStock[store][r.matchKey];
        const skuToUse = entry ? entry.rawSku : r.matchKey;
        byStore[store][skuToUse] = (byStore[store][skuToUse] || 0) + qty;
      }
    });
  });

  const container = document.getElementById('downloadLinks');
  container.innerHTML = '';
  let any = false;
  const rec = activePedidoRecord();
  const nameSlug = rec ? '_' + slugify(rec.titulo) : '';
  STORES.forEach(s => {
    const entries = Object.entries(byStore[s]);
    if (!entries.length) return;
    any = true;
    const rows = entries.map(([sku, qty]) => [sku, qty]);
    const a = downloadCSV(`retirada_${s.toLowerCase()}${nameSlug}_${todayStr()}.csv`, ['SKU', 'QUANTITY'], rows);
    a.textContent = `Descargar retirada ${STORE_LABELS[s]} (${entries.length} refs)`;
    container.appendChild(a);
  });
  if (!any) toast('No hay asignaciones aprobadas para generar CSVs.');
  renderAbastecidas();
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/* ============ Abastecidas ============ */

function renderAbastecidas() {
  const tbody = document.querySelector('#tableAbastecidas tbody');
  tbody.innerHTML = '';
  state.dashboard.forEach(r => {
    const bloqueada = (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad') && !r.aprobado;
    const asignado = bloqueada ? 0 : Object.values(r.asignaciones || {}).reduce((a, b) => a + b, 0);
    const abastecido = Math.min(r.pedido, r.stockWh + asignado);
    if (abastecido <= 0) return;
    const pendiente = Math.max(0, r.pedido - abastecido);
    const skuCell = r.pendienteCatalogo
      ? `${r.whSku} <span class="badge badge-warn">sugerido — crear en catálogo</span>`
      : r.whSku;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${skuCell}</td><td>${r.nombre}</td><td>${abastecido}</td><td>${pendiente > 0 ? pendiente : '—'}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btnGenerarAlta').addEventListener('click', () => {
  const rows = [];
  state.dashboard.forEach(r => {
    const bloqueada = (r.estado === 'pendiente_ventas' || r.estado === 'pendiente_ultima_unidad') && !r.aprobado;
    const asignado = bloqueada ? 0 : Object.values(r.asignaciones || {}).reduce((a, b) => a + b, 0);
    const abastecido = Math.min(r.pedido, r.stockWh + asignado);
    if (abastecido > 0) rows.push([r.whSku, abastecido]);
  });
  const container = document.getElementById('downloadAltaLinks');
  container.innerHTML = '';
  if (!rows.length) { toast('No hay piezas abastecidas todavía.'); return; }
  const rec = activePedidoRecord();
  const nameSlug = rec ? '_' + slugify(rec.titulo) : '';
  const a = downloadCSV(`alta_wholesale${nameSlug}_${todayStr()}.csv`, ['SKU', 'QUANTITY'], rows);
  a.textContent = `Descargar alta Wholesale (${rows.length} refs)`;
  container.appendChild(a);
});

/* ============ Repo semanal entre tiendas ============ */

function storeGuessRegex(store, kind) {
  const abbr = STORE_ABBR[store].toLowerCase();
  const label = STORE_LABELS[store].toLowerCase();
  const kindPattern = kind === 'stock' ? '(stock|available|existenc)' : '(sales|ventas|vendid)';
  const base = `(${abbr}|${label}).*${kindPattern}|${kindPattern}.*(${abbr}|${label})`;
  if (kind !== 'sales') return base;
  // Si el CSV trae ventas de varias ventanas (p.ej. "rambla_ventas_1m" y
  // "rambla_ventas_3m"), no autoseleccionar las de 2 a 12 meses: solo debe
  // proponerse automáticamente la columna de 1 mes (o sin periodo indicado).
  return `(?!.*([2-9]|1[0-2])\\s*m(es(es)?)?\\b)(?:${base})`;
}

function renderRepoImportCount() {
  document.getElementById('repoImportCount').textContent = state.repoSemanal.rows.length;
}

// Las referencias Wholesale (SKU con el prefijo configurado, p.ej. "WH-...",
// o nombre que empieza por "(WH)") no participan en la repo semanal entre
// tiendas físicas — se omiten directamente al importar el CSV del report.
function isWholesaleRepoRow(sku, nombre) {
  const prefix = (state.catalogRules.whPrefix || 'WH-').toUpperCase();
  const skuUp = (sku || '').toUpperCase();
  const nombreUp = (nombre || '').toUpperCase().trim();
  return (prefix && skuUp.startsWith(prefix)) || nombreUp.startsWith('(WH)');
}

// Excluye del cálculo del Top20 las referencias que no son un producto real
// en venta (gift cards, envoltorios/opciones de regalo, accesorios...),
// según los prefijos de SKU y palabras clave de nombre configurados.
function isRealProductForTop20(row) {
  const sku = (row.sku || '').toUpperCase();
  const nombre = (row.nombre || '').toUpperCase();
  const prefixes = state.config.top20ExcludePrefixes || [];
  const keywords = state.config.top20ExcludeKeywords || [];
  if (prefixes.some(p => p && sku.startsWith(p.toUpperCase()))) return false;
  if (keywords.some(k => k && nombre.includes(k.toUpperCase()))) return false;
  return true;
}

// Marca, por tienda, las 20 referencias con más ventas en el último mes
// (de entre los productos reales) — se recalcula tras importar o pulsar
// "Calcular sugerencias de traspaso".
function computeTop20() {
  STORES.forEach(s => {
    const eligible = state.repoSemanal.rows.filter(r => isRealProductForTop20(r) && (r.sales[s] || 0) > 0);
    eligible.sort((a, b) => (b.sales[s] || 0) - (a.sales[s] || 0));
    const topSkus = new Set(eligible.slice(0, 20).map(r => r.sku));
    state.repoSemanal.rows.forEach(r => {
      if (!r.top20) r.top20 = {};
      r.top20[s] = topSkus.has(r.sku);
    });
  });
}

document.getElementById('inputRepoReport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFileAsText(file);
  const { headers, rows } = parseCSV(text);
  const container = document.getElementById('mappingRepo');
  const fields = [
    { key: 'sku', label: 'SKU', required: true, guess: '^sku$|codigo' },
    { key: 'nombre', label: 'Nombre del producto', required: true, guess: 'product|nombre|descrip|name' },
  ];
  STORES.forEach(s => {
    fields.push({ key: 'stock_' + s, label: `Stock ${STORE_LABELS[s]}`, required: false, guess: storeGuessRegex(s, 'stock') });
    fields.push({ key: 'sales_' + s, label: `Ventas 1m ${STORE_LABELS[s]}`, required: false, guess: storeGuessRegex(s, 'sales') });
  });
  fields.push({ key: 'sales_ONLINE', label: 'Ventas 1m Online (se suma a Amigó)', required: false, guess: 'online' });
  renderMapping(container, headers, fields, (mapping) => {
    const bySku = {};
    const fresh = [];
    let skippedWholesale = 0;
    rows.forEach(r => {
      const sku = normalizeSku(r[mapping.sku]);
      if (!sku) return;
      const nombreRaw = (mapping.nombre !== null ? r[mapping.nombre] : '') || sku;
      if (isWholesaleRepoRow(sku, nombreRaw)) { skippedWholesale++; return; }
      let entry = bySku[sku];
      if (!entry) {
        entry = { sku, nombre: nombreRaw, stock: {}, sales: {}, movimientos: [], top20: {} };
        STORES.forEach(s => { entry.stock[s] = 0; entry.sales[s] = 0; entry.top20[s] = false; });
        bySku[sku] = entry;
        fresh.push(entry);
      }
      STORES.forEach(s => {
        const stockCol = mapping['stock_' + s];
        const salesCol = mapping['sales_' + s];
        if (stockCol !== null) {
          const v = parseInt(r[stockCol], 10);
          if (!isNaN(v)) entry.stock[s] += v;
        }
        if (salesCol !== null) {
          const v = parseInt(r[salesCol], 10);
          if (!isNaN(v)) entry.sales[s] += v;
        }
      });
      // Las ventas online se sirven desde el almacén de Amigó, así que se
      // suman a sus ventas para reflejar la salida real de stock desde allí.
      const onlineCol = mapping.sales_ONLINE;
      if (onlineCol !== null) {
        const v = parseInt(r[onlineCol], 10);
        if (!isNaN(v)) entry.sales.AMIGO += v;
      }
    });
    state.repoSemanal.rows = fresh;
    computeTop20();
    saveState();
    renderRepoImportCount();
    renderRepoTable();
    toast(`Repo semanal: ${fresh.length} SKUs importados` + (skippedWholesale ? ` (${skippedWholesale} Wholesale omitidos).` : '.'));
  });
});

// Calcula los traspasos de un SKU según necesidad real, no proporción de
// ventas: cada tienda destino tiene un margen objetivo (ventas + colchón) y
// se cubre encadenando orígenes con Amigó primero, respetando el margen que
// cada origen debe conservar. Si el SKU es top20 de la tienda destino, se
// asume una necesidad extrema (p.ej. su referencia más vendida) y se relaja
// el margen protegido de Amigó (reserva mínima absoluta) más el de un único
// origen secundario adicional (1ud, el que menos necesidad propia tenga).
// Requiere que row.top20 esté ya calculado (ver computeTop20()).

// Si en la misma fila una tienda recibe de A y por separado envía a B (aun
// usando stock propio previo, no el recién recibido), es más simple y
// evita manipulación doble que A envíe directo a B — colapsa esas cadenas
// A→intermedia→B en un único traspaso A→B mientras queden pares posibles.
function consolidarCadenasIntermedias(movimientos) {
  let cambiado = true;
  while (cambiado) {
    cambiado = false;
    for (const intermedia of STORES) {
      const entrantes = movimientos.filter(m => m.to === intermedia && m.qty > 0);
      const salientes = movimientos.filter(m => m.from === intermedia && m.qty > 0);
      for (const inc of entrantes) {
        for (const out of salientes) {
          if (inc.qty <= 0 || out.qty <= 0) continue;
          const qty = Math.min(inc.qty, out.qty);
          if (qty <= 0) continue;
          if (inc.from === out.to) {
            // A envía a la intermedia y esta reenvía justo a A: se anula,
            // esas unidades no debían moverse en absoluto.
            inc.qty -= qty; out.qty -= qty; cambiado = true; continue;
          }
          inc.qty -= qty; out.qty -= qty;
          const directo = movimientos.find(m => m.from === inc.from && m.to === out.to);
          if (directo) directo.qty += qty; else movimientos.push({ from: inc.from, to: out.to, qty });
          cambiado = true;
        }
      }
    }
    movimientos = movimientos.filter(m => m.qty > 0);
  }
  return movimientos;
}

function computeMovimientosParaFila(row) {
  const cfg = state.config;
  // stock: cuánto tiene cada tienda "ahora mismo" en esta pasada (sube al
  // recibir un traspaso, baja al enviar uno) — se usa para saber cuánto le
  // sigue faltando a un destino. giveable: cuánto puede CEDER cada tienda
  // como origen — solo baja al ceder, nunca sube al recibir, para que una
  // tienda no pueda "redonar" stock que acaba de recibir para cubrir su
  // propia carencia (eso dejaría un traspaso que hoy no existe realmente).
  const stock = {}, giveable = {}, sales = {};
  STORES.forEach(s => { stock[s] = row.stock[s] || 0; giveable[s] = row.stock[s] || 0; sales[s] = row.sales[s] || 0; });
  const movimientos = [];

  function needTarget(store) {
    if (store === 'MADRID') return sales.MADRID + cfg.repoBufferMadrid;
    if (store === 'AMIGO') return sales.AMIGO;
    return sales[store] + cfg.repoBufferRamblaValencia;
  }

  function addMov(from, to, qty) {
    if (qty <= 0) return;
    const existing = movimientos.find(m => m.from === from && m.to === to);
    if (existing) existing.qty += qty; else movimientos.push({ from, to, qty });
    stock[from] -= qty;
    stock[to] += qty;
    giveable[from] -= qty;
  }

  const destinos = STORES
    .map(s => ({ store: s, shortage: needTarget(s) - stock[s], extreme: !!(row.top20 && row.top20[s]) }))
    .filter(d => d.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage);

  destinos.forEach(dest => {
    let falta = needTarget(dest.store) - stock[dest.store];
    if (falta <= 0) return;

    if (dest.store !== 'AMIGO') {
      const floorAmigo = dest.extreme ? cfg.repoAmigoTop20MinStock : (sales.AMIGO + cfg.repoAmigoProtectedMargin);
      const disponible = giveable.AMIGO - floorAmigo;
      if (disponible > 0) {
        const qty = Math.min(disponible, falta);
        addMov('AMIGO', dest.store, qty);
        falta -= qty;
      }
    }
    if (falta <= 0) return;

    if (dest.extreme) {
      // Caso extremo (top20 del destino): no se sigue la cascada normal por
      // margen en el resto de tiendas — como mucho 1ud de la que tenga menos
      // necesidad propia de este SKU, y se acepta no cubrir el resto.
      const candidatos = STORES
        .filter(s => s !== 'AMIGO' && s !== dest.store && giveable[s] > 1)
        .sort((a, b) => (needTarget(a) - stock[a]) - (needTarget(b) - stock[b]));
      if (candidatos.length) addMov(candidatos[0], dest.store, 1);
      return;
    }

    STORES.filter(s => s !== 'AMIGO' && s !== dest.store).forEach(origin => {
      if (falta <= 0) return;
      const disponible = giveable[origin] - sales[origin];
      if (disponible <= 0) return;
      const qty = Math.min(disponible, falta);
      addMov(origin, dest.store, qty);
      falta -= qty;
    });
  });

  // Último recurso: si la cascada anterior no ha movido nada en absoluto
  // (escasez real de todo el sistema, nadie tiene margen que ceder), se
  // cede 1ud desde la tienda con mejor margen hacia la más urgente (más
  // ventas y menos stock), aunque baje de su propio mínimo.
  if (!movimientos.length) {
    const enDeficit = STORES.filter(s => stock[s] < sales[s]);
    if (enDeficit.length) {
      enDeficit.sort((a, b) => (sales[b] - stock[b]) - (sales[a] - stock[a]));
      const destino = enDeficit[0];
      const candidatos = STORES.filter(s => s !== destino && giveable[s] > 0)
        .sort((a, b) => (stock[b] - sales[b]) - (stock[a] - sales[a]));
      if (candidatos.length) addMov(candidatos[0], destino, 1);
    }
  }

  return consolidarCadenasIntermedias(movimientos);
}

document.getElementById('btnCalcularRepo').addEventListener('click', () => {
  if (!state.repoSemanal.rows.length) { toast('No hay datos importados todavía.'); return; }
  computeTop20();
  state.repoSemanal.rows.forEach(row => {
    row.movimientos = computeMovimientosParaFila(row);
  });
  saveState();
  renderRepoTable();
  document.getElementById('repoCalcInfo').textContent = `Calculado a las ${new Date().toLocaleTimeString('es-ES')}`;
});

function movQtyForPair(row, from, to) {
  const m = (row.movimientos || []).find(mv => mv.from === from && mv.to === to);
  return m ? m.qty : 0;
}

function setMovQtyForPair(row, from, to, qty) {
  if (!Array.isArray(row.movimientos)) row.movimientos = [];
  const m = row.movimientos.find(mv => mv.from === from && mv.to === to);
  if (qty <= 0) {
    if (m) row.movimientos = row.movimientos.filter(mv => mv !== m);
  } else if (m) {
    m.qty = qty;
  } else {
    row.movimientos.push({ from, to, qty });
  }
}

// Devuelve el valor de una fila para una clave de orden dada (ver
// SORT_KEY_* en repoTableHeadHtml / sortLabelHtml).
function repoSortValue(row, key) {
  if (key === 'nombre') return (row.nombre || '').toLowerCase();
  if (key === 'sku') return row.sku || '';
  if (key.startsWith('top20_')) return (row.top20 && row.top20[key.slice(6)]) ? 1 : 0;
  if (key.startsWith('sales_')) return row.sales[key.slice(6)] || 0;
  if (key.startsWith('stock_')) return row.stock[key.slice(6)] || 0;
  if (key.startsWith('mov_')) {
    const [f, t] = key.slice(4).split('>');
    return movQtyForPair(row, f, t);
  }
  return 0;
}

// Cabecera de columna clicable para ordenar la tabla por esa columna
// (asc/desc alternando); las columnas numéricas empiezan de mayor a menor,
// para encontrar rápido los traspasos/ventas/stock más grandes.
function sortLabelHtml(key, label) {
  const sortBy = state.repoSemanal.sortBy;
  const active = sortBy && sortBy.key === key;
  const arrow = active ? (sortBy.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<span class="sortLabel${active ? ' active' : ''}" data-sort-key="${key}" title="Ordenar por ${label}">${label}${arrow}</span>`;
}

// Cabecera de cada columna de traspaso: el icono de embudo activa/desactiva
// el filtro "solo filas con movimiento en esta columna" (varias a la vez se
// combinan con OR, como pedía revisar cada traspaso por separado).
function repoTableHeadHtml() {
  const top20Th = STORES.map(s => `<th class="top20-col">${sortLabelHtml('top20_' + s, `Top20 ${STORE_ABBR[s]}`)}</th>`).join('');
  const stockSalesTh = STORES.map(s =>
    `<th>${sortLabelHtml('sales_' + s, `Ventas 1m ${STORE_ABBR[s]}`)}</th><th>${sortLabelHtml('stock_' + s, `Stock ${STORE_ABBR[s]}`)}</th>`
  ).join('');
  const activeFilters = state.repoSemanal.colFilters || [];
  const movTh = MOVEMENT_ORDER.map(([f, t]) => {
    const key = f + '>' + t;
    const active = activeFilters.includes(key);
    return `<th class="movCol${active ? ' colFilterActive' : ''}">${sortLabelHtml('mov_' + key, `${STORE_ABBR[f]}→${STORE_ABBR[t]}`)}
      <button type="button" class="colFilterBtn${active ? ' active' : ''}" data-pair="${key}" title="Ver solo filas con movimiento en ${STORE_ABBR[f]}→${STORE_ABBR[t]}">▾ filtrar</button></th>`;
  }).join('');
  return `<tr><th>${sortLabelHtml('nombre', 'Producto')}</th><th>${sortLabelHtml('sku', 'SKU')}</th>${top20Th}${stockSalesTh}${movTh}</tr>`;
}

// Las 6 columnas de traspaso (3 salidas + 3 entradas) que tocan a una tienda,
// para el filtro rápido "ver traspasos de esta tienda".
function storeMovementPairKeys(store) {
  return MOVEMENT_ORDER.filter(([f, t]) => f === store || t === store).map(([f, t]) => f + '>' + t);
}

function renderRepoStoreChips() {
  const el = document.getElementById('repoStoreChips');
  if (!el) return;
  const activeFilters = state.repoSemanal.colFilters || [];
  el.innerHTML = STORES.map(s => {
    const pairs = storeMovementPairKeys(s);
    const active = pairs.every(p => activeFilters.includes(p));
    return `<button type="button" class="chip-btn${active ? ' active' : ''}" data-store="${s}" title="Ver solo filas con algún traspaso de o hacia ${STORE_LABELS[s]}">${STORE_ABBR[s]}</button>`;
  }).join('');
  el.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const store = e.currentTarget.dataset.store;
      const pairs = storeMovementPairKeys(store);
      const allActive = pairs.every(p => state.repoSemanal.colFilters.includes(p));
      if (allActive) {
        state.repoSemanal.colFilters = state.repoSemanal.colFilters.filter(k => !pairs.includes(k));
      } else {
        pairs.forEach(p => { if (!state.repoSemanal.colFilters.includes(p)) state.repoSemanal.colFilters.push(p); });
      }
      saveState();
      renderRepoTable();
    });
  });
}

// Acota el alto de la caja de scroll de la tabla de traspasos al hueco real
// que queda hasta el borde de la ventana, para que su barra de scroll
// (horizontal y vertical) quede siempre visible cerca de la cabecera en vez
// de quedar empujada al final de una tabla que puede tener muchas filas.
// Solo actúa si la pestaña está visible; se recalcula al cambiar de pestaña,
// al redimensionar la ventana y cada vez que se vuelve a pintar la tabla
// (el contenido de encima puede cambiar de alto, p. ej. al mostrar el aviso
// de filtros activos).
function adjustRepoTableScrollHeight() {
  const panel = document.getElementById('tab-traspasos');
  if (!panel || !panel.classList.contains('active')) return;
  const box = panel.querySelector('.table-scroll');
  if (!box) return;
  const top = box.getBoundingClientRect().top;
  const available = window.innerHeight - top - 16;
  box.style.maxHeight = Math.max(240, Math.round(available)) + 'px';
}
window.addEventListener('resize', adjustRepoTableScrollHeight);

// Reconstruir la tabla (thead+tbody) dentro del propio handler "change" de un
// <input> puede hacer que el navegador dispare otro "change" reentrante para
// ese mismo input al retirarlo del DOM todavía enfocado (efecto secundario
// del blur implícito). Este candado evita procesar esa llamada duplicada,
// que si no se filtra deja los botones de filtro con dos listeners y anula
// su clic (empuja y quita el filtro en el mismo gesto).
let repoTableRenderBusy = false;
function renderRepoTable() {
  if (repoTableRenderBusy) return;
  repoTableRenderBusy = true;
  try {
    renderRepoTableInner();
  } finally {
    repoTableRenderBusy = false;
  }
}

function renderRepoTableInner() {
  document.querySelector('#tableRepo thead').innerHTML = repoTableHeadHtml();
  document.getElementById('tableRepo').classList.toggle('hide-top20', !!state.repoSemanal.hideTop20);
  const onlyMovEl = document.getElementById('repoOnlyWithMov');
  if (onlyMovEl) onlyMovEl.checked = !!state.repoSemanal.onlyWithMovement;
  const hideTop20El = document.getElementById('repoHideTop20');
  if (hideTop20El) hideTop20El.checked = !!state.repoSemanal.hideTop20;

  const tbody = document.querySelector('#tableRepo tbody');
  tbody.innerHTML = '';
  const filterVal = (document.getElementById('repoFilter').value || '').toLowerCase();
  const activeFilters = state.repoSemanal.colFilters || [];
  let rows = state.repoSemanal.rows.filter(r =>
    !filterVal || r.sku.toLowerCase().includes(filterVal) || (r.nombre || '').toLowerCase().includes(filterVal)
  );
  if (state.repoSemanal.onlyWithMovement) {
    rows = rows.filter(r => (r.movimientos || []).some(m => m.qty > 0));
  }
  if (activeFilters.length) {
    rows = rows.filter(r => activeFilters.some(key => {
      const [f, t] = key.split('>');
      return movQtyForPair(r, f, t) > 0;
    }));
  }

  const sortBy = state.repoSemanal.sortBy;
  const sortedRows = sortBy && sortBy.key
    ? [...rows].sort((a, b) => {
        const va = repoSortValue(a, sortBy.key);
        const vb = repoSortValue(b, sortBy.key);
        const dir = sortBy.dir === 'asc' ? 1 : -1;
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
      })
    : sortByNombre(rows, r => r.nombre).map(({ item }) => item);

  sortedRows.forEach((row) => {
    const tr = document.createElement('tr');
    const top20Td = STORES.map(s => `<td class="top20-col ${row.top20 && row.top20[s] ? 'top20-yes' : 'top20-no'}">${row.top20 && row.top20[s] ? 'SI' : 'NO'}</td>`).join('');
    const stockSalesTd = STORES.map(s => `<td>${row.sales[s] || 0}</td><td>${row.stock[s] || 0}</td>`).join('');
    // Si un mismo SKU tiene más de un traspaso a la vez (p. ej. recibe de una
    // tienda y envía a otra), se resaltan sus cantidades para que no pasen
    // desapercibidas al revisar la fila. Si además una cantidad supera el
    // stock disponible en la tienda de origen, se marca como aviso (tiene
    // prioridad visual sobre el resaltado de "múltiples traspasos").
    const activeMovCount = (row.movimientos || []).filter(m => m.qty > 0).length;
    const movTd = MOVEMENT_ORDER.map(([f, t]) => {
      const qty = movQtyForPair(row, f, t);
      const exceedsStock = qty > 0 && qty > (row.stock[f] || 0);
      let cls = '';
      let title = '';
      if (exceedsStock) {
        cls = ' qty-exceeds-stock';
        title = ` title="${STORE_LABELS[f]} solo tiene ${row.stock[f] || 0} en stock: revisa esta cantidad"`;
      } else if (qty > 0 && activeMovCount > 1) {
        cls = ' multi-mov';
      }
      return `<td><input type="number" min="0" value="${qty}" class="movPairInput${cls}" data-sku="${row.sku}" data-from="${f}" data-to="${t}"${title}></td>`;
    }).join('');
    tr.innerHTML = `<td>${row.nombre}</td><td>${row.sku}</td>${top20Td}${stockSalesTd}${movTd}`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.movPairInput').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const row = state.repoSemanal.rows.find(r => r.sku === e.target.dataset.sku);
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      setMovQtyForPair(row, e.target.dataset.from, e.target.dataset.to, v);
      saveState();
      renderRepoTable();
    });
  });

  document.querySelectorAll('#tableRepo thead .colFilterBtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = e.target.dataset.pair;
      const idx = state.repoSemanal.colFilters.indexOf(key);
      if (idx === -1) state.repoSemanal.colFilters.push(key);
      else state.repoSemanal.colFilters.splice(idx, 1);
      saveState();
      renderRepoTable();
    });
  });

  document.querySelectorAll('#tableRepo thead .sortLabel').forEach(el => {
    el.addEventListener('click', (e) => {
      const key = e.currentTarget.dataset.sortKey;
      const cur = state.repoSemanal.sortBy;
      let dir;
      if (cur && cur.key === key) dir = cur.dir === 'asc' ? 'desc' : 'asc';
      else dir = (key === 'nombre' || key === 'sku') ? 'asc' : 'desc';
      state.repoSemanal.sortBy = { key, dir };
      saveState();
      renderRepoTable();
    });
  });

  renderRepoStoreChips();
  renderRepoFilterInfo();
  renderRepoSummary();
  adjustRepoTableScrollHeight();
}

function renderRepoFilterInfo() {
  const el = document.getElementById('repoColFilterInfo');
  if (!el) return;
  const active = state.repoSemanal.colFilters || [];
  if (!active.length) { el.innerHTML = ''; return; }
  const labels = active.map(key => { const [f, t] = key.split('>'); return `${STORE_ABBR[f]}→${STORE_ABBR[t]}`; }).join(', ');
  el.innerHTML = `<span class="muted">Filtrando solo filas con movimiento en: ${labels}</span> <button type="button" id="btnClearColFilters" class="btn-small">Quitar filtros de columna</button>`;
  document.getElementById('btnClearColFilters').addEventListener('click', () => {
    state.repoSemanal.colFilters = [];
    saveState();
    renderRepoTable();
  });
}

document.getElementById('repoFilter').addEventListener('input', renderRepoTable);
document.getElementById('repoOnlyWithMov').addEventListener('change', (e) => {
  state.repoSemanal.onlyWithMovement = e.target.checked;
  saveState();
  renderRepoTable();
});
document.getElementById('repoHideTop20').addEventListener('change', (e) => {
  state.repoSemanal.hideTop20 = e.target.checked;
  saveState();
  renderRepoTable();
});

function renderRepoSummary() {
  const el = document.getElementById('repoSummary');
  const totals = {};
  MOVEMENT_ORDER.forEach(([f, t]) => { totals[f + '>' + t] = 0; });
  let totalUnidades = 0, totalLineas = 0;
  state.repoSemanal.rows.forEach(row => {
    (row.movimientos || []).forEach(m => {
      if (m.qty <= 0) return;
      const key = m.from + '>' + m.to;
      totals[key] = (totals[key] || 0) + m.qty;
      totalUnidades += m.qty;
      totalLineas++;
    });
  });
  const chips = MOVEMENT_ORDER.map(([f, t]) => {
    const v = totals[f + '>' + t] || 0;
    return v > 0 ? `<div class="chip">${STORE_ABBR[f]} → ${STORE_ABBR[t]}<b>${v}</b></div>` : '';
  }).join('');
  el.innerHTML = `<div class="store-summary">
    <div class="chip">Movimientos (líneas)<b>${totalLineas}</b></div>
    <div class="chip">Unidades totales<b>${totalUnidades}</b></div>
    ${chips}
  </div>`;
}

document.getElementById('btnGenerarCSVsRepo').addEventListener('click', () => {
  const byPair = {};
  MOVEMENT_ORDER.forEach(([f, t]) => { byPair[f + '>' + t] = {}; });
  state.repoSemanal.rows.forEach(row => {
    (row.movimientos || []).forEach(m => {
      if (m.qty <= 0) return;
      const key = m.from + '>' + m.to;
      if (!byPair[key]) return;
      byPair[key][row.sku] = (byPair[key][row.sku] || 0) + m.qty;
    });
  });

  const container = document.getElementById('downloadLinksRepo');
  container.innerHTML = '';
  let any = false;
  MOVEMENT_ORDER.forEach(([f, t]) => {
    const entries = Object.entries(byPair[f + '>' + t]);
    if (!entries.length) return;
    any = true;
    const rowsOut = entries.map(([sku, qty]) => [sku, qty]);
    const filename = `repo_${STORE_ABBR[f].toLowerCase()}_${STORE_ABBR[t].toLowerCase()}_${todayStr()}.csv`;
    const a = downloadCSV(filename, ['SKU', 'QUANTITY'], rowsOut);
    a.textContent = `${STORE_ABBR[f]} → ${STORE_ABBR[t]} (${entries.length} refs)`;
    container.appendChild(a);
  });
  if (!any) toast('No hay traspasos para generar CSVs.');
});

/* ============ Factura ============ */

// Numeración correlativa simple (AÑO-NNNN). Se asigna una sola vez por
// pedido guardado, al "emitir" la factura, y no se reutiliza aunque se
// borre esa factura, para no repetir números ya emitidos.
function nextFacturaNumero() {
  const year = new Date().getFullYear();
  const n = state.facturaConfig.facturaCounter;
  return `${year}-${String(n).padStart(4, '0')}`;
}

function renderFactura() {
  const el = document.getElementById('facturaContent');
  if (!el) return;
  const rec = activePedidoRecord();
  if (!rec) {
    el.innerHTML = '<p class="muted">Abre o guarda un pedido (pestaña "3. Pedido Wholesale") para generar su factura.</p>';
    return;
  }
  if (!rec.clienteTipo) rec.clienteTipo = 'nacional';

  const lineas = state.pedido.filter(p => p.cantidad > 0);
  const base = lineas.reduce((a, p) => a + (p.cantidad || 0) * (p.precio || 0), 0);
  const esInternacional = rec.clienteTipo === 'internacional';
  const ivaPct = esInternacional ? 0 : state.facturaConfig.ivaPorcentaje;
  const iva = base * ivaPct / 100;
  const total = base + iva;

  const lineasHtml = sortByNombre(lineas, p => p.nombre).map(({ item: p }) => `<tr>
      <td>${p.whSku}</td><td>${p.nombre}</td><td>${p.cantidad}</td>
      <td>${(p.precio || 0).toFixed(2)} €</td><td>${((p.cantidad || 0) * (p.precio || 0)).toFixed(2)} €</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="card" id="facturaPrintArea">
      <div class="factura-header">
        <div>
          <h3>${state.facturaConfig.empresaNombre || 'Nombre de la empresa (ver Reglas/Config)'}</h3>
          <p class="muted">${state.facturaConfig.empresaNif || 'NIF pendiente'}<br>${state.facturaConfig.empresaDireccion || ''}</p>
        </div>
        <div class="factura-meta">
          <p><strong>Factura ${rec.facturaNumero || '(sin emitir)'}</strong></p>
          <p class="muted">Fecha: ${rec.facturaFecha ? new Date(rec.facturaFecha).toLocaleDateString('es-ES') : '—'}</p>
        </div>
      </div>

      <div class="inline-fields">
        <label>Cliente
          <input type="text" id="facturaClienteNombre" value="${rec.cliente || ''}">
        </label>
        <label>Tipo de cliente
          <select id="facturaClienteTipo">
            <option value="nacional" ${!esInternacional ? 'selected' : ''}>Nacional (IVA ${state.facturaConfig.ivaPorcentaje}%)</option>
            <option value="internacional" ${esInternacional ? 'selected' : ''}>Internacional (exento de IVA)</option>
          </select>
        </label>
        <label>NIF / VAT cliente
          <input type="text" id="facturaClienteNif" value="${rec.clienteNif || ''}">
        </label>
        <label>Dirección cliente
          <input type="text" id="facturaClienteDireccion" value="${rec.clienteDireccion || ''}">
        </label>
      </div>
      ${esInternacional ? '<p><span class="badge badge-warn">Cliente internacional — factura exenta de IVA (exportación / operación intracomunitaria)</span></p>' : ''}

      <div class="table-scroll">
        <table><thead><tr><th>SKU</th><th>Nombre</th><th>Cantidad</th><th>Precio unit.</th><th>Importe</th></tr></thead>
        <tbody>${lineasHtml || '<tr><td colspan="5" class="muted">Sin líneas en el pedido.</td></tr>'}</tbody></table>
      </div>

      <div class="factura-totales">
        <div><span>Base imponible</span><b>${base.toFixed(2)} €</b></div>
        <div><span>IVA (${ivaPct}%)</span><b>${iva.toFixed(2)} €</b></div>
        <div class="total"><span>Total</span><b>${total.toFixed(2)} €</b></div>
      </div>
    </div>
    <div class="card no-print">
      <button id="btnEmitirFactura" class="btn-primary" ${rec.facturaNumero ? 'disabled' : ''}>${rec.facturaNumero ? 'Factura ya emitida' : 'Emitir factura (asignar número)'}</button>
      <button id="btnImprimirFactura" class="btn-ghost">Imprimir / Guardar como PDF</button>
    </div>`;

  document.getElementById('facturaClienteNombre').addEventListener('change', (e) => {
    rec.cliente = e.target.value.trim();
    saveState();
    renderPedidosTab();
    renderActivePedidoBanner();
  });
  document.getElementById('facturaClienteTipo').addEventListener('change', (e) => {
    rec.clienteTipo = e.target.value;
    saveState();
    renderFactura();
  });
  document.getElementById('facturaClienteNif').addEventListener('change', (e) => {
    rec.clienteNif = e.target.value.trim();
    saveState();
  });
  document.getElementById('facturaClienteDireccion').addEventListener('change', (e) => {
    rec.clienteDireccion = e.target.value.trim();
    saveState();
  });
  if (!rec.facturaNumero) {
    document.getElementById('btnEmitirFactura').addEventListener('click', () => {
      rec.facturaNumero = nextFacturaNumero();
      rec.facturaFecha = new Date().toISOString();
      state.facturaConfig.facturaCounter++;
      saveState();
      renderFactura();
      toast(`Factura ${rec.facturaNumero} emitida.`);
    });
  }
  document.getElementById('btnImprimirFactura').addEventListener('click', () => window.print());
}

/* ============ Config ============ */

function loadConfigForm() {
  document.getElementById('cfgPrefix').value = state.catalogRules.whPrefix;
  document.getElementById('cfgAliasOro').value = state.catalogRules.aliasOro.join(',');
  document.getElementById('cfgAliasRodio').value = state.catalogRules.aliasRodio.join(',');
  document.getElementById('cfgMaterialDefault').value = state.catalogRules.materialDefault;
  document.getElementById('cfgSalesWindow').value = state.config.salesWindowDays;
  document.getElementById('cfgSalesThreshold').value = state.config.salesThreshold;
  document.getElementById('cfgWarnLastUnit').checked = state.config.warnLastUnit;
  document.getElementById('cfgSecondaryCriterion').value = state.config.secondaryCriterion;
  document.getElementById('cfgTop20ExcludePrefixes').value = state.config.top20ExcludePrefixes.join(',');
  document.getElementById('cfgTop20ExcludeKeywords').value = state.config.top20ExcludeKeywords.join(',');
  document.getElementById('cfgRepoBufferMadrid').value = state.config.repoBufferMadrid;
  document.getElementById('cfgRepoBufferRamblaValencia').value = state.config.repoBufferRamblaValencia;
  document.getElementById('cfgRepoAmigoProtectedMargin').value = state.config.repoAmigoProtectedMargin;
  document.getElementById('cfgRepoAmigoTop20MinStock').value = state.config.repoAmigoTop20MinStock;
  document.getElementById('cfgEmpresaNombre').value = state.facturaConfig.empresaNombre;
  document.getElementById('cfgEmpresaNif').value = state.facturaConfig.empresaNif;
  document.getElementById('cfgEmpresaDireccion').value = state.facturaConfig.empresaDireccion;
  document.getElementById('cfgIvaPorcentaje').value = state.facturaConfig.ivaPorcentaje;
}

function splitAliasList(v) {
  return v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

document.getElementById('btnSaveRules').addEventListener('click', () => {
  state.catalogRules.whPrefix = document.getElementById('cfgPrefix').value || 'WH-';
  state.catalogRules.aliasOro = splitAliasList(document.getElementById('cfgAliasOro').value);
  state.catalogRules.aliasRodio = splitAliasList(document.getElementById('cfgAliasRodio').value);
  state.catalogRules.materialDefault = document.getElementById('cfgMaterialDefault').value;
  saveState();
  toast('Reglas de SKU guardadas. Vuelve a importar catálogo y stocks para que se apliquen.');
});

document.getElementById('btnSaveConfig').addEventListener('click', () => {
  state.config.salesWindowDays = parseInt(document.getElementById('cfgSalesWindow').value, 10) || 30;
  state.config.salesThreshold = parseInt(document.getElementById('cfgSalesThreshold').value, 10) || 0;
  state.config.warnLastUnit = document.getElementById('cfgWarnLastUnit').checked;
  state.config.secondaryCriterion = document.getElementById('cfgSecondaryCriterion').value;
  state.config.top20ExcludePrefixes = splitAliasList(document.getElementById('cfgTop20ExcludePrefixes').value);
  state.config.top20ExcludeKeywords = document.getElementById('cfgTop20ExcludeKeywords').value
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  state.config.repoBufferMadrid = parseInt(document.getElementById('cfgRepoBufferMadrid').value, 10) || 0;
  state.config.repoBufferRamblaValencia = parseInt(document.getElementById('cfgRepoBufferRamblaValencia').value, 10) || 0;
  state.config.repoAmigoProtectedMargin = parseInt(document.getElementById('cfgRepoAmigoProtectedMargin').value, 10) || 0;
  state.config.repoAmigoTop20MinStock = parseInt(document.getElementById('cfgRepoAmigoTop20MinStock').value, 10) || 0;
  computeTop20();
  saveState();
  renderStoreSalesSummary();
  renderRepoTable();
  toast('Criterios guardados. Vuelve a importar ventas si cambió la ventana de días.');
});

document.getElementById('btnSaveFacturaConfig').addEventListener('click', () => {
  state.facturaConfig.empresaNombre = document.getElementById('cfgEmpresaNombre').value.trim();
  state.facturaConfig.empresaNif = document.getElementById('cfgEmpresaNif').value.trim();
  state.facturaConfig.empresaDireccion = document.getElementById('cfgEmpresaDireccion').value.trim();
  state.facturaConfig.ivaPorcentaje = parseFloat(document.getElementById('cfgIvaPorcentaje').value) || 0;
  saveState();
  renderFactura();
  toast('Datos de facturación guardados.');
});

/* ============ Backup / Reset ============ */

document.getElementById('btnExportBackup').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `nunu_backup_${todayStr()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

document.getElementById('inputImportBackup').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFileAsText(file);
  try {
    const parsed = JSON.parse(text);
    state = mergeIntoDefault(parsed);
    saveState();
    renderAll();
    toast('Backup importado correctamente.');
  } catch (err) {
    toast('El archivo de backup no es válido.');
  }
});

document.getElementById('btnResetAll').addEventListener('click', () => {
  if (!confirm('Esto borrará todos los datos guardados en este navegador (catálogo, stock, pedidos guardados, dashboard). ¿Continuar?')) return;
  state = defaultState();
  saveState();
  renderAll();
  toast('Datos reiniciados.');
});

/* ============ Render inicial ============ */

function renderAll() {
  renderCatalogTable();
  renderStockWholesaleSummary();
  renderStoreStockSummary();
  renderStoreSalesSummary();
  renderPedidoTable();
  renderDashboard();
  renderAbastecidas();
  renderActivePedidoBanner();
  renderPedidosTab();
  renderFactura();
  renderRepoImportCount();
  computeTop20();
  renderRepoTable();
  loadConfigForm();
  saveState();
}

renderAll();
restoreActiveTab();
