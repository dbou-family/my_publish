// import.js — Importer des recettes depuis un export MyRecipeBox (CSV)
(() => {
  // Catégories MyRecipeBox sans équivalent direct dans l'application
  const CATEGORY_ALIASES = { 'prépa dessert': 'Dessert' };
  const DEFAULT_CATEGORY = 'Plat';
  const UNIT = '(?:kg|g|mg|cl|ml|dl|l|cac|cas|c\\.\\s?à\\s?[cs]\\.|pièces?|sachets?|tranches?|gousses?|pincées?|brins?|feuilles?|boîtes?|branches?|verres?|bouquets?|poignées?|cm|oeufs?|œufs?)';
  // "400 g de farine" -> quantité "400 g", nom "farine"
  const INGREDIENT_RE = new RegExp(`^(\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?)\\s*(${UNIT})?(?!\\p{L})\\s*(?:(?:de|d['’])\\s*)?(.+)$`, 'iu');

  let pending = [];

  const normalize = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const keyOf = (s) => String(s).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];

  // ---------- Lecture du CSV (RFC 4180 : guillemets, retours à la ligne dans les champs) ----------
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', i = 0, inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => f.trim() !== ''));
  }

  function parseMyRecipeBoxCsv(text) {
    const table = parseCsv(String(text).replace(/^\uFEFF/, ''));
    if (!table.length) return [];
    const headers = table[0].map(h => h.trim());
    if (!headers.includes('title')) {
      throw new Error('Ce fichier ne ressemble pas à un export MyRecipeBox (colonne « title » absente).');
    }
    return table.slice(1).map(cells => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])));
  }

  // ---------- Conversion vers le modèle de l'application ----------
  function parseMinutes(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return 0;
    const h = s.match(/(\d+)\s*h\s*(\d+)?/);
    if (h) return Number(h[1]) * 60 + Number(h[2] || 0);
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function parseServings(quantity) {
    const m = String(quantity ?? '').trim().match(/^(\d{1,2})(?=\s|$)/);
    const n = m ? Number(m[1]) : 0;
    return n >= 1 && n <= 50 ? n : 0;
  }

  function mapCategory(raw) {
    const parts = String(raw ?? '').split(';').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const main = CATEGORIES.find(c => c.toLowerCase() === p.toLowerCase());
      if (main) return main;
    }
    for (const p of parts) {
      const alias = CATEGORY_ALIASES[p.toLowerCase()];
      if (alias) return alias;
    }
    return DEFAULT_CATEGORY;
  }

  function parseIngredients(raw) {
    return normalize(raw).split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(INGREDIENT_RE);
      if (m && m[3].trim()) {
        return [m[3].trim(), [m[1], m[2]].filter(Boolean).join(' ')];
      }
      return [line, 'Non précisée'];
    });
  }

  function parseSteps(raw) {
    const text = normalize(raw);
    // Deux formats : « Étape 1 : … » ou paragraphes séparés par une ligne vide / des lignes simples
    let parts = /Étape\s*\d+/i.test(text)
      ? text.split(/Étape\s*\d+\s*:?/i)
      : text.split(/\n\s*\n/);
    if (parts.length === 1) parts = text.split('\n');
    return parts
      .flatMap(p => p.split(/\n\s*\n/))
      .map(s => s.replace(/^\s*\d+\s*[_.)\-]\s*/, '').replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean);
  }

  // Note MyRecipeBox « 0 à 5 » par pas de 0,5 ; absente ou vide -> pas de note
  function parseRating(v) {
    const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.max(0, Math.min(5, n)) * 2) / 2;
  }

  function toRecipe(row, index, stamp) {
    const url = v => (/^https?:\/\//i.test(String(v ?? '').trim()) ? String(v).trim() : '');
    const source = url(row.source);
    const totalFromParts = [row.preparationTime, row.cookingTime, row.inactiveTime]
      .reduce((sum, v) => sum + parseMinutes(v), 0);
    return {
      id: `imp${stamp}_${index}`,
      name: row.title.trim(),
      category: mapCategory(row.categories),
      time: parseMinutes(row.totalTime) || totalFromParts,
      servings: parseServings(row.quantity),
      difficulty: '',
      image: url(row.originalPicture),
      description: normalize(row.description).replace(/\s+/g, ' ').trim(),
      ingredients: parseIngredients(row.ingredients),
      steps: parseSteps(row.instructions),
      favorite: String(row.favorite ?? '').trim().toLowerCase() === 'true',
      ...(parseRating(row.rating) !== null ? { rating: parseRating(row.rating) } : {}),
      // Ordre décroissant pour que le tri « Les plus récentes » garde l'ordre du fichier
      createdAt: new Date(stamp - index * 1000).toISOString(),
      ...(source ? { sourceUrl: source } : {})
    };
  }

  // ---------- Fenêtre de sélection ----------
  function rowHtml(p, i) {
    const r = p.recipe;
    const img = r.image ? ` style='background-image:url("${esc(r.image)}")'` : '';
    const meta = [
      formatTime(r.time),
      r.servings ? `${r.servings} pers.` : '',
      r.steps.length ? `${r.steps.length} étape${r.steps.length > 1 ? 's' : ''}` : '',
      r.rating ? `${String(r.rating).replace('.', ',')} / 5` : '',
      p.duplicate ? 'déjà au carnet' : ''
    ].filter(Boolean).join(' · ');
    return `<li class="import-row${p.duplicate ? ' is-duplicate' : ''}">
      <label class="import-check"><input type="checkbox" data-import-index="${i}"${p.selected ? ' checked' : ''} aria-label="Importer ${esc(r.name)}"></label>
      <div class="import-thumb"${img}></div>
      <div class="import-info"><b>${esc(r.name)}${r.favorite ? ' <span class="import-fav">♥</span>' : ''}</b><small>${esc(meta)}</small>${r.rating ? `<span class="import-stars">${renderStars(r.rating)}</span>` : ''}</div>
      <select data-import-cat="${i}" aria-label="Catégorie de ${esc(r.name)}">${CATEGORIES.map(c => `<option${c === p.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
    </li>`;
  }

  function refreshCount() {
    const n = pending.filter(p => p.selected).length;
    q('#importCount').textContent = `${n} sur ${pending.length} sélectionnée(s)`;
    const btn = q('#confirmImport');
    btn.disabled = n === 0;
    btn.textContent = n ? `Importer ${n} recette${n > 1 ? 's' : ''}` : 'Importer';
  }

  function confirmImport() {
    const chosen = pending.filter(p => p.selected).map(p => ({ ...p.recipe, category: p.category }));
    if (!chosen.length) return;
    const previous = recipes;
    recipes = [...chosen, ...recipes];
    try {
      save();
    } catch (err) {
      recipes = previous;
      toast('Impossible d’enregistrer les recettes : stockage du navigateur plein ?');
      return;
    }
    pending = [];
    closeDialog();
    render();
    toast(`${chosen.length} recette${chosen.length > 1 ? 's' : ''} importée${chosen.length > 1 ? 's' : ''}`);
  }

  function openImportDialog(fileName, items) {
    const existing = new Set(recipes.map(r => keyOf(r.name)));
    pending = items.map(recipe => {
      const duplicate = existing.has(keyOf(recipe.name));
      return { recipe, category: recipe.category, selected: !duplicate, duplicate };
    });
    const n = items.length;
    showDialog(`<div class="import-content">
      <h2 id="dialogTitle">Importer des recettes</h2>
      <p class="import-lead">Fichier <b>${esc(fileName)}</b> : ${n} recette${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''}. Cochez celles à ajouter à votre carnet. Les recettes déjà présentes sont décochées par défaut.</p>
      <div class="import-bar"><button type="button" class="text-link" id="importAll">Tout sélectionner</button><button type="button" class="text-link" id="importNone">Tout désélectionner</button><span id="importCount"></span></div>
      <ul class="import-list">${pending.map(rowHtml).join('')}</ul>
      <div class="import-footer"><button type="button" class="sync-secondary" id="cancelImport">Annuler</button><button type="button" class="sync-primary" id="confirmImport">Importer</button></div>
    </div>`);

    qa('[data-import-index]').forEach(el => {
      el.addEventListener('change', () => {
        pending[Number(el.dataset.importIndex)].selected = el.checked;
        refreshCount();
      });
    });
    qa('[data-import-cat]').forEach(el => {
      el.addEventListener('change', () => {
        pending[Number(el.dataset.importCat)].category = el.value;
      });
    });
    const setAll = (value) => {
      pending.forEach(p => { p.selected = value; });
      qa('[data-import-index]').forEach(el => { el.checked = value; });
      refreshCount();
    };
    q('#importAll').addEventListener('click', () => setAll(true));
    q('#importNone').addEventListener('click', () => setAll(false));
    q('#cancelImport').addEventListener('click', () => { pending = []; closeDialog(); });
    q('#confirmImport').addEventListener('click', confirmImport);
    refreshCount();
  }

  // ---------- Styles de la fenêtre (injectés pour ne pas modifier styles.css) ----------
  function injectStyles() {
    if (document.getElementById('import-styles')) return;
    const style = document.createElement('style');
    style.id = 'import-styles';
    style.textContent = `
.import-content{padding:30px}
.import-content h2{font:500 25px 'Playfair Display',serif;color:#2b382f;margin:0 0 8px}
.import-lead{font-size:11px;color:#788175;line-height:1.65;margin:0 0 16px}
.import-bar{display:flex;align-items:center;gap:14px;font-size:10px;margin-bottom:10px}
.import-bar span{margin-left:auto;color:#858d81}
.import-list{list-style:none;margin:0;padding:0;max-height:50vh;overflow:auto;border:1px solid #e4e8df;border-radius:8px;background:#fff}
.import-row{display:grid;grid-template-columns:auto 56px minmax(0,1fr) 140px;gap:12px;align-items:center;padding:9px 12px;border-bottom:1px solid #f0ede6}
.import-row:last-child{border-bottom:0}
.import-row.is-duplicate{opacity:.6}
.import-check input{width:16px;height:16px;margin:0;accent-color:#455b43;cursor:pointer}
.import-thumb{width:56px;height:42px;border-radius:6px;background:#e7e3d9 center/cover no-repeat}
.import-info{min-width:0}
.import-info b{display:block;font:600 13px 'Playfair Display',serif;color:#2c382f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.import-fav{color:#c56b50;font-family:'DM Sans',sans-serif}
.import-info small{display:block;font-size:10px;color:#858d81;margin-top:3px}
.import-stars{display:block;margin-top:3px;font-size:10px}
.import-row select{width:100%;padding:7px;border:1px solid #e2e7de;border-radius:6px;background:#fff;font:10px 'DM Sans',sans-serif;color:#4c463d}
.import-footer{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}
.import-footer .sync-primary:disabled{opacity:.5;cursor:not-allowed}
@media (max-width:600px){.import-content{padding:22px 18px}.import-row{grid-template-columns:auto 44px minmax(0,1fr)}.import-row select{grid-column:2 / -1}}
@media (max-width:700px){.import-label{display:none}}
html[data-theme="dark"] .import-list{background:#26231d;border-color:#3a352d}
html[data-theme="dark"] .import-content h2,html[data-theme="dark"] .import-info b{color:#ece4d4}
html[data-theme="dark"] .import-row{border-color:#34302a}
html[data-theme="dark"] .import-row select{background:#1f1c17;border-color:#3a352d;color:#ece4d4}
`;
    document.head.appendChild(style);
  }

  // ---------- Démarrage ----------
  function init() {
    injectStyles();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.hidden = true;
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const text = typeof file.text === 'function'
          ? await file.text()
          : await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file, 'utf-8');
            });
        const rows = parseMyRecipeBoxCsv(text).filter(r => r.title && r.title.trim());
        if (!rows.length) { toast('Aucune recette trouvée dans ce fichier.'); return; }
        const stamp = Date.now();
        openImportDialog(file.name, rows.map((r, i) => toRecipe(r, i, stamp)));
      } catch (err) {
        toast(err.message || 'Lecture du fichier impossible');
      }
    });

    document.getElementById('importBtn')?.addEventListener('click', () => input.click());
  }

  window.MyRecipeBoxImport = { parseMyRecipeBoxCsv, toRecipe, parseIngredients, parseSteps, mapCategory, parseRating };
  if (typeof document !== 'undefined' && document.body) init();
})();
