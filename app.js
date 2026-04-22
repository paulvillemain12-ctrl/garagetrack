'use strict';

// ─── CONFIG SUPABASE ─────────────────────────────────────────────────────────
const SUPABASE_URL_KEY = 'gt_sb_url';
const SUPABASE_KEY_KEY = 'gt_sb_key';
const API_KEY_STORE = 'garagetrack_apikey';
const LOCAL_CACHE = 'garagetrack_cache_v1';

function getSupabaseUrl() { return localStorage.getItem(SUPABASE_URL_KEY) || ''; }
function getSupabaseKey() { return localStorage.getItem(SUPABASE_KEY_KEY) || ''; }
function getApiKey() { return localStorage.getItem(API_KEY_STORE) || ''; }
function saveApiKey(k) { localStorage.setItem(API_KEY_STORE, k); }

let db = { projets: [], depenses: [], sessions: [] };
let supabaseReady = false;

// ─── SUPABASE HELPERS ────────────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!url || !key) return null;
  const res = await fetch(url + '/rest/v1/' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) { console.error('Supabase error:', await res.text()); return null; }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ─── LOAD / SAVE ─────────────────────────────────────────────────────────────
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_CACHE)) || { projets: [], depenses: [], sessions: [] }; }
  catch { return { projets: [], depenses: [], sessions: [] }; }
}

function saveLocal(d) {
  try { localStorage.setItem(LOCAL_CACHE, JSON.stringify(d)); } catch(e) {}
}

async function loadFromSupabase() {
  try {
    const [projets, depenses, sessions] = await Promise.all([
      sbFetch('projets?order=created_at.asc'),
      sbFetch('depenses?order=created_at.asc'),
      sbFetch('sessions?order=created_at.asc')
    ]);
    if (projets === null) return false;
    db.projets = (projets || []).map(p => ({...p}));
    db.depenses = (depenses || []).map(d => ({
      ...d, projetId: d.projet_id, desc: d.description, date: d.date_achat
    }));
    db.sessions = (sessions || []).map(s => ({
      ...s, projetId: s.projet_id, desc: s.description, date: s.date_session,
      tasks: typeof s.tasks === 'string' ? JSON.parse(s.tasks||'[]') : (s.tasks||[])
    }));
    saveLocal(db);
    return true;
  } catch(e) { console.error('Load error:', e); return false; }
}

async function save(d) {
  saveLocal(d);
}

async function sbInsert(table, row) {
  const clean = {...row};
  delete clean.id;
  const res = await sbFetch(table, { method: 'POST', body: JSON.stringify(clean), prefer: 'return=representation' });
  return res?.[0] || null;
}

async function sbUpdate(table, id, data) {
  const clean = {...data};
  delete clean.id;
  await sbFetch(table + '?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(clean), prefer: 'return=minimal' });
}

async function sbDelete(table, id) {
  await sbFetch(table + '?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' });
}

// ─── MIGRATION LOCAL → SUPABASE ──────────────────────────────────────────────
async function migrateLocalData() {
  // Essaie d'abord le cache local, puis l'ancien store
  const cached = JSON.parse(localStorage.getItem('garagetrack_cache_v1') || '{}');
  const legacy = JSON.parse(localStorage.getItem('garagetrack_v1') || '{}');
  const old = cached.projets?.length ? cached : legacy;
  if (!old.projets?.length) return;
  toast('Migration des données en cours...');
  for (const p of old.projets) {
    await sbFetch('projets', { method: 'POST', body: JSON.stringify({
      id: p.id, nom: p.nom, immat: p.immat, annee: p.annee,
      achat: p.achat, budget: p.budget, revente: p.revente,
      notes: p.notes, photo: p.photo, created_at: new Date(p.createdAt||Date.now()).toISOString()
    }), prefer: 'return=minimal' });
  }
  for (const d of (old.depenses||[])) {
    await sbFetch('depenses', { method: 'POST', body: JSON.stringify({
      id: d.id, projet_id: d.projetId, description: d.desc, fourn: d.fourn,
      montant: d.montant, cat: d.cat, date_achat: d.date, photo: d.photo
    }), prefer: 'return=minimal' });
  }
  for (const s of (old.sessions||[])) {
    await sbFetch('sessions', { method: 'POST', body: JSON.stringify({
      id: s.id, projet_id: s.projetId, description: s.desc, duree: s.duree,
      date_session: s.date, tasks: JSON.stringify(s.tasks||[])
    }), prefer: 'return=minimal' });
  }
  localStorage.removeItem('garagetrack_v1');
  toast('Migration terminée ✓');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmt(n) { return Number(n).toFixed(2).replace('.', ',') + ' €'; }
function fmtInt(n) { return Math.round(n) + ' €'; }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { if (!d) return ''; const [y,m,j] = d.split('-'); return `${j}/${m}/${y}`; }

function toast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
let currentPage = 'projets';

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  currentPage = page;
  if (page === 'projets') renderProjets();
  if (page === 'depenses') { fillSelect('dep-projet'); renderDepenses(); }
  if (page === 'temps') { fillSelect('tps-projet'); renderTemps(); }
  if (page === 'bilan') { fillSelect('bilan-projet'); renderBilan(); }
  if (page === 'entretien') { fillSelect('entretien-projet'); onEntretienProjetChange(); }
}

// ─── MODALS ──────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }

// ─── PHOTOS ──────────────────────────────────────────────────────────────────
function previewPhoto(input, previewId, placeholderId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById(previewId);
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById(placeholderId).style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function previewMultiPhoto(input) {
  const preview = document.getElementById('dep-photo-preview');
  const placeholder = document.getElementById('dep-photo-placeholder');
  if (!input.files.length) return;
  const reader = new FileReader();
  reader.onload = e => {
    preview.src = e.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    if (input.files.length > 1) {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>' + input.files.length + ' photos</span>';
    }
  };
  reader.readAsDataURL(input.files[0]);
}

function getPhotoData(inputId, maxSize) {
  return new Promise(resolve => {
    const input = document.getElementById(inputId);
    if (!input.files[0]) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = e => {
      if (!maxSize) { resolve(e.target.result); return; }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  });
}

// ─── API KEY MODAL ───────────────────────────────────────────────────────────
function openApiKeyModal() {
  document.getElementById('api-key-input').value = getApiKey();
  openModal('modal-api-key');
}

function saveApiKeyFromModal() {
  const k = document.getElementById('api-key-input').value.trim();
  if (!k.startsWith('sk-ant-')) { toast('Clé invalide (doit commencer par sk-ant-)'); return; }
  saveApiKey(k);
  closeModal('modal-api-key');
  toast('Clé API enregistrée ✓');
}


// ─── RECONNAISSANCE FACTURE ──────────────────────────────────────────────────
async function analyserFacture() {
  const apiKey = getApiKey();
  if (!apiKey) { toast('Configure ta cle API'); openApiKeyModal(); return; }
  const input = document.getElementById('dep-photo-input');
  if (!input.files.length) { toast('Selectionne au moins une photo'); return; }
  const btn = document.getElementById('btn-analyser');
  const total = input.files.length;
  btn.disabled = true;

  try {
    let tousLesProduits = [];
    let dernierFournisseur = '';

    for (let i = 0; i < input.files.length; i++) {
      btn.textContent = total > 1 ? 'Analyse ' + (i+1) + '/' + total + '...' : 'Analyse en cours...';
      const file = input.files[i];
      const photoData = await compressFile(file, 1200);
      const base64 = photoData.split(',')[1];
      const mediaType = 'image/jpeg';

      const response = await fetch('https://restless-star-0f7c.paulvillemain12.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 800,
          system: 'Tu es un extracteur de donnees de factures. Tu reponds TOUJOURS et UNIQUEMENT avec du JSON valide, sans aucun texte avant ou apres, sans markdown, sans backticks.',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Extrais les produits de cette facture. Format strict: {"fournisseur":"nom ou null","produits":[{"description":"nom piece max 40 chars","montant":12.50,"categorie":"Pieces mecaniques|Carrosserie|Electrique|Fluides consommables|Outillage|Autre"}]}. Si pas de facture lisible: {"erreur":"non lisible"}' }
          ]}]
        })
      });

      if (!response.ok) { const e = await response.json(); throw new Error(e.error?.message || 'Erreur API'); }
      const data = await response.json();
      const rawText = data.content[0].text.trim();
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const result = JSON.parse(jsonMatch[0]);
      if (result.erreur) continue;
      if (result.fournisseur) dernierFournisseur = result.fournisseur;
      if (result.produits) tousLesProduits = tousLesProduits.concat(result.produits);
    }

    if (!tousLesProduits.length) { toast('Aucun produit detecte'); return; }

    if (tousLesProduits.length === 1) {
      const p = tousLesProduits[0];
      if (p.description) document.getElementById('dep-desc').value = p.description;
      if (p.montant) document.getElementById('dep-montant').value = p.montant;
      if (dernierFournisseur) document.getElementById('dep-fourn').value = dernierFournisseur;
      toast('1 produit detecte - verifie les infos');
    } else {
      openMultiProductModal(tousLesProduits, dernierFournisseur);
    }

  } catch (e) {
    if (e.message.includes('401')) toast('Cle API incorrecte');
    else if (e.message.includes('429')) toast('Limite atteinte, reessaie');
    else toast('Erreur: ' + e.message.slice(0, 50));
  } finally { btn.textContent = "Analyser avec l'IA"; btn.disabled = false; }
}

function compressFile(file, maxSize) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

let pendingMultiProducts = [], pendingFournisseur = '';

function openMultiProductModal(produits, fournisseur) {
  pendingMultiProducts = produits; pendingFournisseur = fournisseur || '';
  const total = produits.reduce((a, p) => a + (p.montant || 0), 0);
  const cats = ['Pieces mecaniques','Carrosserie','Electrique','Fluides consommables','Outillage','Autre'];
  document.getElementById('multi-product-list').innerHTML = produits.map((p, i) =>
    '<div style="padding:10px 0;border-bottom:0.5px solid var(--border)">' +
    '<input class="input" id="mp-desc-' + i + '" value="' + p.description + '" style="margin-bottom:6px;font-size:13px" />' +
    '<div style="display:flex;gap:8px">' +
    '<input class="input" id="mp-montant-' + i + '" type="number" value="' + p.montant + '" style="width:90px;font-size:13px" />' +
    '<select class="input" id="mp-cat-' + i + '" style="flex:1;font-size:12px">' + cats.map(c => '<option' + (c===p.categorie?' selected':'') + '>' + c + '</option>').join('') + '</select>' +
    '<button class="dep-delete" onclick="pendingMultiProducts.splice(' + i + ',1);openMultiProductModal(pendingMultiProducts,pendingFournisseur)">x</button>' +
    '</div></div>').join('');
  document.getElementById('multi-product-total').textContent = total.toFixed(2) + ' EUR';
  document.getElementById('multi-product-count').textContent = produits.length;
  openModal('modal-multi-product');
}

async function confirmMultiProducts() {
  const pid = document.getElementById('dep-projet').value;
  if (!pid) { toast('Selectionne un projet'); return; }
  const photoData = await getPhotoData('dep-photo-input');
  const dateVal = document.getElementById('dep-date').value || today();
  pendingMultiProducts.forEach((p, i) => {
    const desc = document.getElementById('mp-desc-' + i)?.value || p.description;
    const montant = parseFloat(document.getElementById('mp-montant-' + i)?.value) || p.montant;
    const cat = document.getElementById('mp-cat-' + i)?.value || p.categorie;
    if (montant > 0) db.depenses.push({ id: uid(), projetId: pid, photo: i === 0 ? photoData : null, desc, fourn: pendingFournisseur, montant, cat, date: dateVal });
  });
  save(db);
  if (supabaseReady) {
    pendingMultiProducts.forEach((p, i) => {
      const d = db.depenses[db.depenses.length - pendingMultiProducts.length + i];
      if (d) sbFetch('depenses', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ id: d.id, projet_id: d.projetId, description: d.desc, fourn: d.fourn, montant: d.montant, cat: d.cat, date_achat: d.date, photo: d.photo })});
    });
  }
  closeModal('modal-multi-product'); closeModal('modal-new-dep');
  ['dep-desc','dep-fourn','dep-montant'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('dep-photo-preview').style.display = 'none';
  document.getElementById('dep-photo-placeholder').style.display = 'flex';
  document.getElementById('dep-photo-input').value = '';
  renderDepenses();
  toast(pendingMultiProducts.length + ' depenses ajoutees');
}

// ─── SELECT HELPERS ──────────────────────────────────────────────────────────
function fillSelect(id) {
  const s = document.getElementById(id);
  const cur = s.value;
  if (!db.projets.length) {
    s.innerHTML = '<option value="">— Aucun projet —</option>';
    return;
  }
  s.innerHTML = db.projets.map(p => `<option value="${p.id}">${p.nom}${p.immat ? ' · ' + p.immat : ''}</option>`).join('');
  if (cur && db.projets.find(p => p.id === cur)) s.value = cur;
}

// ─── PROJETS ─────────────────────────────────────────────────────────────────
function renderProjets() {
  const list = document.getElementById('proj-list');
  const empty = document.getElementById('proj-empty');
  if (!db.projets.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  list.innerHTML = db.projets.map(p => {
    const deps = db.depenses.filter(d => d.projetId === p.id).reduce((a, d) => a + d.montant, 0);
    const hrs = db.sessions.filter(s => s.projetId === p.id).reduce((a, s) => a + s.duree, 0);
    const budget = p.budget || 0;
    const pct = budget > 0 ? Math.min(120, Math.round(deps / budget * 100)) : 0;
    const color = pct > 100 ? 'var(--red)' : pct > 80 ? 'var(--orange)' : 'var(--green)';
    const photoHtml = p.photo
      ? `<img class="proj-card-photo" src="${p.photo}" alt="${p.nom}" />`
      : `<div class="proj-card-photo-placeholder">🚗</div>`;
    const badgeStyle = pct > 100 ? 'background:rgba(248,81,73,0.85);color:#fff' : pct > 80 ? 'background:rgba(240,136,62,0.85);color:#fff' : 'background:rgba(57,211,83,0.85);color:#000';
    return `<div class="proj-card" onclick="openProjetDetail('${p.id}')">
      ${photoHtml}
      <div class="proj-card-shade"></div>
      ${budget > 0 ? `<div class="proj-card-badge" style="${badgeStyle}">${pct}% budget</div>` : ''}
      <div class="proj-card-body">
        <div class="proj-card-title">${p.nom.toUpperCase()}</div>
        <div class="proj-card-sub">${[p.immat, p.annee].filter(Boolean).join(' · ') || 'Appuie pour le détail'}</div>
        <div class="proj-card-stats">
          <div class="stat"><span class="stat-val">${fmtInt(deps)}</span><span class="stat-lbl">Dépensé${budget ? ' / ' + fmtInt(budget) : ''}</span></div>
          <div class="stat"><span class="stat-val">${hrs.toFixed(1)} h</span><span class="stat-lbl">Travaillées</span></div>
          ${p.revente ? `<div class="stat"><span class="stat-val">${fmtInt(p.revente)}</span><span class="stat-lbl">Revente visée</span></div>` : ''}
        </div>
      </div>
      ${budget > 0 ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div>` : ''}
    </div>`;
  }).join('');
}

function openProjetDetail(id) {
  const p = db.projets.find(x => x.id === id);
  if (!p) return;
  document.getElementById('detail-titre').textContent = p.nom;
  const deps = db.depenses.filter(d => d.projetId === id).reduce((a, d) => a + d.montant, 0);
  const body = document.getElementById('detail-body');
  body.innerHTML = `
    ${p.photo ? `<img src="${p.photo}" style="width:100%;border-radius:10px;margin-bottom:8px" />` : ''}
    ${p.immat ? `<div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;color:var(--text2);margin-bottom:12px">${p.immat}${p.annee ? ' · ' + p.annee : ''}</div>` : ''}
    <div class="metrics-row" style="padding:0;margin-bottom:12px">
      <div class="metric-card"><div class="metric-lbl">Achat</div><div class="metric-val">${fmtInt(p.achat||0)}</div></div>
      <div class="metric-card"><div class="metric-lbl">Pièces</div><div class="metric-val">${fmtInt(deps)}</div></div>
      <div class="metric-card"><div class="metric-lbl">Budget</div><div class="metric-val">${fmtInt(p.budget||0)}</div></div>
      <div class="metric-card"><div class="metric-lbl">Revente</div><div class="metric-val">${fmtInt(p.revente||0)}</div></div>
    </div>
    ${p.notes ? `<div style="font-size:14px;color:var(--text2);background:var(--bg3);border-radius:10px;padding:12px">${p.notes}</div>` : ''}
  `;
  document.getElementById('detail-footer').innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <button class="btn-secondary" style="flex:1" onclick="openEditProjet('${id}')">Modifier</button>
      <button class="btn-primary" style="flex:2" onclick="closeModal('modal-detail-projet');navigate('depenses');setTimeout(()=>{document.getElementById('dep-projet').value='${id}';renderDepenses()},100)">Voir les dépenses</button>
    </div>
    <button class="btn-secondary full-width" style="color:#A32D2D;border-color:#F09595" onclick="deleteProjet('${id}')">Supprimer le projet</button>
  `;
  openModal('modal-detail-projet');
}

async function addProjet() {
  const nom = document.getElementById('np-nom').value.trim();
  if (!nom) { toast('Donne un nom au projet !'); return; }
  const photo = await getPhotoData('proj-photo-input');
  const newProjet = {
    id: uid(), nom, photo,
    immat: document.getElementById('np-immat').value.trim(),
    annee: document.getElementById('np-annee').value.trim(),
    achat: parseFloat(document.getElementById('np-achat').value) || 0,
    budget: parseFloat(document.getElementById('np-budget').value) || 0,
    revente: parseFloat(document.getElementById('np-revente').value) || 0,
    notes: document.getElementById('np-notes').value.trim(),
    createdAt: Date.now()
  };
  db.projets.push(newProjet);
  save(db);
  if (supabaseReady) {
    sbFetch('projets', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      id: newProjet.id, nom: newProjet.nom, photo: newProjet.photo,
      immat: newProjet.immat, annee: newProjet.annee, achat: newProjet.achat,
      budget: newProjet.budget, revente: newProjet.revente, notes: newProjet.notes,
      created_at: new Date().toISOString()
    })});
  }
  ['np-nom','np-immat','np-annee','np-achat','np-budget','np-revente','np-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('proj-photo-preview').style.display = 'none';
  document.getElementById('proj-photo-placeholder').style.display = 'flex';
  document.getElementById('proj-photo-input').value = '';
  closeModal('modal-new-projet');
  renderProjets();
  toast('Projet créé ✓');
}

function openEditProjet(id) {
  const p = db.projets.find(x => x.id === id);
  if (!p) return;
  closeModal('modal-detail-projet');
  document.getElementById('edit-proj-id').value = id;
  document.getElementById('edit-np-nom').value = p.nom || '';
  document.getElementById('edit-np-immat').value = p.immat || '';
  document.getElementById('edit-np-annee').value = p.annee || '';
  document.getElementById('edit-np-achat').value = p.achat || '';
  document.getElementById('edit-np-budget').value = p.budget || '';
  document.getElementById('edit-np-revente').value = p.revente || '';
  document.getElementById('edit-np-notes').value = p.notes || '';
  const preview = document.getElementById('edit-proj-photo-preview');
  const placeholder = document.getElementById('edit-proj-photo-placeholder');
  if (p.photo) {
    preview.src = p.photo; preview.style.display = 'block'; placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none'; placeholder.style.display = 'flex';
  }
  openModal('modal-edit-projet');
}

async function saveEditProjet() {
  const id = document.getElementById('edit-proj-id').value;
  const p = db.projets.find(x => x.id === id);
  if (!p) return;
  const nom = document.getElementById('edit-np-nom').value.trim();
  if (!nom) { toast('Donne un nom au projet !'); return; }
  const newPhoto = await getPhotoData('edit-proj-photo-input');
  p.nom = nom;
  p.immat = document.getElementById('edit-np-immat').value.trim();
  p.annee = document.getElementById('edit-np-annee').value.trim();
  p.achat = parseFloat(document.getElementById('edit-np-achat').value) || 0;
  p.budget = parseFloat(document.getElementById('edit-np-budget').value) || 0;
  p.revente = parseFloat(document.getElementById('edit-np-revente').value) || 0;
  p.notes = document.getElementById('edit-np-notes').value.trim();
  if (newPhoto) p.photo = newPhoto;
  save(db);
  if (supabaseReady) {
    sbUpdate('projets', id, { nom: p.nom, immat: p.immat, annee: p.annee, achat: p.achat, budget: p.budget, revente: p.revente, notes: p.notes, photo: p.photo });
  }
  closeModal('modal-edit-projet');
  renderProjets();
  toast('Projet mis à jour ✓');
}

async function deleteProjet(id) {
  if (!confirm('Supprimer ce projet et toutes ses données ?')) return;
  db.projets = db.projets.filter(p => p.id !== id);
  db.depenses = db.depenses.filter(d => d.projetId !== id);
  db.sessions = db.sessions.filter(s => s.projetId !== id);
  save(db);
  if (supabaseReady) {
    await sbDelete('projets', id);
    await sbFetch('depenses?projet_id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' });
    await sbFetch('sessions?projet_id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' });
  }
  closeModal('modal-detail-projet');
  renderProjets();
  toast('Projet supprimé');
}

// ─── DEPENSES ────────────────────────────────────────────────────────────────
let depChart = null;

function renderDepenses() {
  const pid = document.getElementById('dep-projet').value;
  const proj = db.projets.find(p => p.id === pid);
  const deps = db.depenses.filter(d => d.projetId === pid);
  const total = deps.reduce((a, d) => a + d.montant, 0);
  const budget = proj?.budget || 0;
  const diff = budget - total;

  document.getElementById('dep-metrics').innerHTML = `
    <div class="metric-card"><div class="metric-lbl">Total dépensé</div><div class="metric-val" style="color:var(--accent)">${fmtInt(total)}</div></div>
    <div class="metric-card"><div class="metric-lbl">Budget restant</div><div class="metric-val" style="color:${diff>=0?'var(--green)':'var(--red)'}">${diff>=0?'+':''}${fmtInt(diff)}</div></div>
    <div class="metric-card"><div class="metric-lbl">Nb factures</div><div class="metric-val">${deps.length}</div></div>
    <div class="metric-card"><div class="metric-lbl">Budget estimé</div><div class="metric-val">${fmtInt(budget)}</div></div>
  `;

  const cats = {};
  deps.forEach(d => { cats[d.cat] = (cats[d.cat] || 0) + d.montant; });
  const catEntries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const chartWrap = document.getElementById('dep-chart-wrap');

  if (catEntries.length > 0) {
    chartWrap.style.display = 'block';
    const ctx = document.getElementById('dep-chart').getContext('2d');
    if (depChart) depChart.destroy();
    depChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([k]) => k),
        datasets: [{ data: catEntries.map(([,v]) => Math.round(v)), backgroundColor: ['#E8FF3D','#39d353','#58a6ff','#f0883e','#f85149','#888'], borderWidth: 0 }]
      },
      options: {
        cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#888', font: { family: 'Barlow', size: 11 }, boxWidth: 12, padding: 8 } } },
        responsive: true
      }
    });
  } else {
    chartWrap.style.display = 'none';
  }

  const listEl = document.getElementById('dep-list');
  if (!deps.length) { listEl.innerHTML = '<div class="empty-state" style="padding:40px 32px"><div class="empty-icon">🧾</div><p>Aucune dépense</p></div>'; return; }
  listEl.innerHTML = `<div class="section-wrap">${deps.sort((a,b)=>b.date.localeCompare(a.date)).map(d => `
    <div class="dep-item">
      ${d.photo ? `<img class="dep-photo" src="${d.photo}" />` : `<div class="dep-photo-placeholder"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`}
      <div class="dep-info">
        <div class="dep-name">${d.desc}</div>
        <div class="dep-sub">${[d.fourn, fmtDate(d.date)].filter(Boolean).join(' · ')}</div>
        <span class="dep-cat">${d.cat}</span>
      </div>
      <div class="dep-amount">${fmtInt(d.montant)}</div>
      <button class="dep-delete" onclick="deleteDep('${d.id}')">✕</button>
    </div>`).join('')}</div>`;
}

async function addDepense() {
  const pid = document.getElementById('dep-projet').value;
  if (!pid) { toast('Sélectionne un projet d\'abord'); return; }
  const montant = parseFloat(document.getElementById('dep-montant').value);
  if (!montant || montant <= 0) { toast('Montant invalide'); return; }
  const photo = await getPhotoData('dep-photo-input');
  const newDep = {
    id: uid(), projetId: pid, photo,
    desc: document.getElementById('dep-desc').value || 'Dépense',
    fourn: document.getElementById('dep-fourn').value,
    montant, cat: document.getElementById('dep-cat').value,
    date: document.getElementById('dep-date').value || today()
  };
  db.depenses.push(newDep);
  save(db);
  if (supabaseReady) {
    sbFetch('depenses', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      id: newDep.id, projet_id: newDep.projetId, description: newDep.desc,
      fourn: newDep.fourn, montant: newDep.montant, cat: newDep.cat,
      date_achat: newDep.date, photo: newDep.photo
    })});
  }
  ['dep-desc','dep-fourn','dep-montant'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('dep-photo-preview').style.display = 'none';
  document.getElementById('dep-photo-placeholder').style.display = 'flex';
  document.getElementById('dep-photo-input').value = '';
  closeModal('modal-new-dep');
  renderDepenses();
  toast('Dépense ajoutée ✓');
}

function deleteDep(id) {
  db.depenses = db.depenses.filter(d => d.id !== id);
  save(db);
  if (supabaseReady) sbDelete('depenses', id);
  renderDepenses();
}

// ─── TIMER ───────────────────────────────────────────────────────────────────
let timerInterval = null, timerStart = null, timerElapsed = 0, timerRunning = false;

function toggleTimer() {
  const btn = document.getElementById('timer-btn');
  if (!timerRunning) {
    timerStart = Date.now() - timerElapsed;
    timerInterval = setInterval(updateTimerDisplay, 1000);
    timerRunning = true;
    btn.textContent = 'Pause';
    document.getElementById('timer-status').textContent = 'En cours...';
    document.getElementById('timer-save').style.display = 'none';
  } else {
    clearInterval(timerInterval);
    timerElapsed = Date.now() - timerStart;
    timerRunning = false;
    btn.textContent = 'Reprendre';
    document.getElementById('timer-status').textContent = 'En pause';
    document.getElementById('timer-save').style.display = 'flex';
  }
}

function resetTimer() {
  clearInterval(timerInterval);
  timerRunning = false; timerElapsed = 0; timerStart = null;
  document.getElementById('timer-display').textContent = '00:00:00';
  document.getElementById('timer-btn').textContent = 'Démarrer';
  document.getElementById('timer-status').textContent = 'Chrono arrêté';
  document.getElementById('timer-save').style.display = 'none';
}

function updateTimerDisplay() {
  const ms = Date.now() - timerStart;
  const s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = Math.floor(ms / 3600000);
  document.getElementById('timer-display').textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function saveTimerSession() {
  const pid = document.getElementById('tps-projet').value;
  if (!pid) { toast('Sélectionne un projet'); return; }
  const duree = parseFloat((timerElapsed / 3600000).toFixed(2));
  if (duree < 0.01) { toast('Durée trop courte'); return; }
  const desc = document.getElementById('tps-desc-timer').value || 'Session chrono';
  const newSess = { id: uid(), projetId: pid, desc, duree, tasks: [], date: today() };
  db.sessions.push(newSess);
  save(db);
  if (supabaseReady) sbFetch('sessions', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ id: newSess.id, projet_id: newSess.projetId, description: newSess.desc, duree: newSess.duree, date_session: newSess.date, tasks: '[]' })});
  document.getElementById('tps-desc-timer').value = '';
  resetTimer();
  renderTemps();
  toast(`Session de ${duree.toFixed(1)}h enregistrée ✓`);
}

// ─── SESSIONS ────────────────────────────────────────────────────────────────
let quickTasks = [];

function addQuickTask() {
  const input = document.getElementById('new-task-input');
  const val = input.value.trim();
  if (!val) return;
  quickTasks.push({ id: uid(), label: val, done: false });
  input.value = '';
  renderQuickTasks();
}

function renderQuickTasks() {
  const el = document.getElementById('task-quick-list');
  el.innerHTML = quickTasks.map(t => `
    <div class="task-item">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''} onchange="quickTasks.find(x=>x.id==='${t.id}').done=this.checked" />
      <span class="task-label">${t.label}</span>
      <button class="task-delete" onclick="quickTasks=quickTasks.filter(x=>x.id!=='${t.id}');renderQuickTasks()">✕</button>
    </div>`).join('');
}

function addSession() {
  const pid = document.getElementById('tps-projet').value;
  if (!pid) { toast('Sélectionne un projet'); return; }
  const duree = parseFloat(document.getElementById('tps-duree').value);
  if (!duree || duree <= 0) { toast('Durée invalide'); return; }
  const manualSess = {
    id: uid(), projetId: pid,
    desc: document.getElementById('tps-desc').value || 'Session',
    duree, tasks: [...quickTasks],
    date: document.getElementById('tps-date').value || today()
  };
  db.sessions.push(manualSess);
  save(db);
  if (supabaseReady) sbFetch('sessions', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ id: manualSess.id, projet_id: manualSess.projetId, description: manualSess.desc, duree: manualSess.duree, date_session: manualSess.date, tasks: JSON.stringify(manualSess.tasks) })});
  ['tps-desc','tps-duree','tps-date'].forEach(id => document.getElementById(id).value = '');
  quickTasks = [];
  renderQuickTasks();
  closeModal('modal-new-session');
  renderTemps();
  toast('Session enregistrée ✓');
}

function renderTemps() {
  const pid = document.getElementById('tps-projet').value;
  const sessions = db.sessions.filter(s => s.projetId === pid);
  const total = sessions.reduce((a, s) => a + s.duree, 0);
  const listEl = document.getElementById('tps-list');
  if (!sessions.length) { listEl.innerHTML = '<div class="empty-state" style="padding:40px 32px"><div class="empty-icon">⏱</div><p>Aucune session</p></div>'; return; }
  listEl.innerHTML = `
    <div style="padding:0 16px 8px;font-family:'Barlow Condensed',sans-serif;font-size:13px;color:var(--text3);letter-spacing:2px">TOTAL · ${total.toFixed(1)} H</div>
    <div class="section-wrap">${sessions.sort((a,b)=>b.date.localeCompare(a.date)).map(s => `
      <div class="session-item">
        <div class="session-info">
          <div class="session-name">${s.desc}</div>
          <div class="session-date">${fmtDate(s.date)}${s.tasks&&s.tasks.length?` · ${s.tasks.filter(t=>t.done).length}/${s.tasks.length} tâches`:''}</div>
        </div>
        <div class="session-dur">${s.duree.toFixed(1)} h</div>
        <button class="dep-delete" onclick="deleteSess('${s.id}')">✕</button>
      </div>`).join('')}</div>`;
}

function deleteSess(id) {
  db.sessions = db.sessions.filter(s => s.id !== id);
  save(db);
  if (supabaseReady) sbDelete('sessions', id);
  renderTemps();
}

// ─── BILAN ───────────────────────────────────────────────────────────────────
let bilanChart = null;

function renderBilan() {
  const pid = document.getElementById('bilan-projet').value;
  const proj = db.projets.find(p => p.id === pid);
  const el = document.getElementById('bilan-content');
  if (!proj) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>Aucun projet</p></div>'; return; }

  const deps = db.depenses.filter(d => d.projetId === pid);
  const sessions = db.sessions.filter(s => s.projetId === pid);
  const totalDeps = deps.reduce((a, d) => a + d.montant, 0);
  const totalHrs = sessions.reduce((a, s) => a + s.duree, 0);
  const achat = proj.achat || 0;
  const revente = proj.revente || 0;
  const coutTotal = totalDeps + achat;
  const marge = revente - coutTotal;
  const taux = totalHrs > 0 ? marge / totalHrs : 0;
  const margeColor = marge >= 0 ? 'var(--green)' : 'var(--red)';
  const tauxColor = taux >= 0 ? 'var(--text2)' : 'var(--red)';

  const cats = {};
  deps.forEach(d => { cats[d.cat] = (cats[d.cat] || 0) + d.montant; });
  const catEntries = Object.entries(cats).sort((a,b) => b[1]-a[1]);
  const catHtml = catEntries.map(([k, v]) => `
    <div class="cat-bar-item">
      <span class="cat-bar-label">${k}</span>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${totalDeps>0?Math.round(v/totalDeps*100):0}%"></div></div>
      <span class="cat-bar-amt">${fmtInt(v)}</span>
    </div>`).join('');

  const byMonth = {};
  deps.forEach(d => {
    const m = (d.date||'').slice(0,7);
    if (m) byMonth[m] = (byMonth[m]||0) + d.montant;
  });
  const months = Object.keys(byMonth).sort();
  const hasMonths = months.length > 1;

  // Liste des pièces changées
  const piecesHtml = deps.sort((a,b) => a.date.localeCompare(b.date)).map(d => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500;color:var(--text)">${d.desc}</div>
        <div style="font-size:11px;color:var(--text3)">${[d.fourn, fmtDate(d.date)].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:600;color:var(--text);white-space:nowrap">${fmtInt(d.montant)}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="bilan-main">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;letter-spacing:2px;color:var(--text3);margin-bottom:8px">MARGE ESTIMÉE</div>
      <div class="bilan-marge" style="color:${margeColor}">${marge >= 0 ? '+' : ''}${fmtInt(marge)}</div>
      <div class="bilan-taux" style="color:${tauxColor}">${taux >= 0 ? '+' : ''}${taux.toFixed(1)} €/h · ${totalHrs.toFixed(1)} h travaillées</div>
    </div>
    <div class="bilan-section">
      <div class="bilan-title">Décomposition</div>
      <div class="metrics-row" style="padding:0">
        <div class="metric-card"><div class="metric-lbl">Achat voiture</div><div class="metric-val">${fmtInt(achat)}</div></div>
        <div class="metric-card"><div class="metric-lbl">Pièces / travaux</div><div class="metric-val">${fmtInt(totalDeps)}</div></div>
        <div class="metric-card"><div class="metric-lbl">Coût total</div><div class="metric-val">${fmtInt(coutTotal)}</div></div>
        <div class="metric-card"><div class="metric-lbl">Revente visée</div><div class="metric-val">${fmtInt(revente)}</div></div>
      </div>
    </div>
    ${catEntries.length ? `<div class="bilan-section"><div class="bilan-title">Répartition dépenses</div>${catHtml}</div>` : ''}
    ${deps.length ? `<div class="bilan-section"><div class="bilan-title">Pièces changées (${deps.length})</div>${piecesHtml}</div>` : ''}
    ${hasMonths ? `<div class="bilan-section"><div class="bilan-title">Évolution mensuelle</div><canvas id="bilan-chart" height="120"></canvas></div>` : ''}
    <div style="padding:0 16px 16px">
      <button class="btn-primary full-width" onclick="genererPDF('${pid}')">Générer le rapport PDF</button>
    </div>
  `;

  if (hasMonths) {
    const ctx = document.getElementById('bilan-chart').getContext('2d');
    if (bilanChart) bilanChart.destroy();
    bilanChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => { const [y,mo]=m.split('-'); return ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(mo)-1]; }),
        datasets: [{ data: months.map(m => Math.round(byMonth[m])), backgroundColor: '#E8FF3D', borderRadius: 4 }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#1e1e1e' }, ticks: { color: '#888', font: { family: 'Barlow', size: 11 } } },
          y: { grid: { color: '#1e1e1e' }, ticks: { color: '#888', font: { family: 'Barlow', size: 11 }, callback: v => v + ' €' } }
        }
      }
    });
  }
}


// ─── GENERATION PDF ──────────────────────────────────────────────────────────
function genererPDF(pid) {
  const proj = db.projets.find(p => p.id === pid);
  if (!proj) return;
  const deps = db.depenses.filter(d => d.projetId === pid);
  const sessions = db.sessions.filter(s => s.projetId === pid);
  const totalDeps = deps.reduce((a, d) => a + d.montant, 0);
  const totalHrs = sessions.reduce((a, s) => a + s.duree, 0);
  const achat = proj.achat || 0;
  const coutTotal = totalDeps + achat;
  const marge = (proj.revente || 0) - coutTotal;
  const taux = totalHrs > 0 ? marge / totalHrs : 0;

  // Grouper par catégorie
  const cats = {};
  deps.forEach(d => { cats[d.cat] = (cats[d.cat] || 0) + d.montant; });

  const dateStr = new Date().toLocaleDateString('fr-FR');
  const depRows = deps.sort((a,b) => a.date.localeCompare(b.date)).map(d =>
    `<tr><td>${fmtDate(d.date)}</td><td>${d.desc}</td><td>${d.fourn||'—'}</td><td>${d.cat}</td><td style="text-align:right;font-weight:600">${fmt(d.montant)}</td></tr>`
  ).join('');

  const catRows = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v]) =>
    `<tr><td>${k}</td><td style="text-align:right;font-weight:600">${fmt(v)}</td><td style="text-align:right;color:#666">${totalDeps>0?Math.round(v/totalDeps*100):0}%</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Rapport — ${proj.nom}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: white; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 3px solid #E8FF3D; }
  .header-left h1 { font-size: 28px; font-weight: 900; letter-spacing: 2px; color: #0a0a0a; }
  .header-left p { font-size: 13px; color: #666; margin-top: 4px; }
  .badge { background: #E8FF3D; color: #0a0a0a; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 4px; display: inline-block; margin-top: 6px; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #888; text-transform: uppercase; margin-bottom: 12px; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .metric { background: #f5f5f5; border-radius: 8px; padding: 12px; }
  .metric-lbl { font-size: 10px; color: #888; margin-bottom: 4px; }
  .metric-val { font-size: 20px; font-weight: 700; }
  .marge { font-size: 36px; font-weight: 900; color: ${marge >= 0 ? '#27ae60' : '#e74c3c'}; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f0f0f0; padding: 8px 10px; text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #666; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  .total-row td { font-weight: 700; background: #f9f9f9; border-top: 2px solid #ddd; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #aaa; text-align: center; }
  .marge-box { background: ${marge >= 0 ? '#f0fdf4' : '#fef2f2'}; border: 2px solid ${marge >= 0 ? '#27ae60' : '#e74c3c'}; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div style="font-size:11px;font-weight:700;letter-spacing:3px;color:#888;margin-bottom:6px">GARAGETRACK</div>
      <h1>${proj.nom.toUpperCase()}</h1>
      <p>${[proj.immat, proj.annee].filter(Boolean).join(' · ') || ''}</p>
      <span class="badge">Rapport du ${dateStr}</span>
    </div>
    <div style="text-align:right">
      <div class="marge-box" style="text-align:center;padding:16px 24px">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#888;margin-bottom:6px">MARGE ESTIMÉE</div>
        <div class="marge">${marge >= 0 ? '+' : ''}${fmtInt(marge)}</div>
        <div style="font-size:12px;color:#666;margin-top:4px">${taux >= 0 ? '+' : ''}${taux.toFixed(1)} €/h · ${totalHrs.toFixed(1)} h</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Résumé financier</div>
    <div class="metrics">
      <div class="metric"><div class="metric-lbl">Prix d'achat</div><div class="metric-val">${fmtInt(achat)}</div></div>
      <div class="metric"><div class="metric-lbl">Pièces / travaux</div><div class="metric-val">${fmtInt(totalDeps)}</div></div>
      <div class="metric"><div class="metric-lbl">Coût total investi</div><div class="metric-val">${fmtInt(coutTotal)}</div></div>
      <div class="metric"><div class="metric-lbl">Prix de revente visé</div><div class="metric-val">${fmtInt(proj.revente||0)}</div></div>
    </div>
  </div>

  ${catRows ? `<div class="section">
    <div class="section-title">Répartition par catégorie</div>
    <table>
      <tr><th>Catégorie</th><th style="text-align:right">Montant</th><th style="text-align:right">Part</th></tr>
      ${catRows}
      <tr class="total-row"><td>Total pièces</td><td style="text-align:right">${fmt(totalDeps)}</td><td></td></tr>
    </table>
  </div>` : ''}

  ${depRows ? `<div class="section">
    <div class="section-title">Détail des pièces changées (${deps.length})</div>
    <table>
      <tr><th>Date</th><th>Description</th><th>Fournisseur</th><th>Catégorie</th><th style="text-align:right">Montant</th></tr>
      ${depRows}
      <tr class="total-row"><td colspan="4">Total</td><td style="text-align:right">${fmt(totalDeps)}</td></tr>
    </table>
  </div>` : ''}

  ${proj.notes ? `<div class="section">
    <div class="section-title">Notes</div>
    <p style="font-size:13px;color:#444;line-height:1.6;background:#f9f9f9;padding:12px;border-radius:6px">${proj.notes}</p>
  </div>` : ''}

  <div class="footer">Généré par GarageTrack · ${dateStr}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rapport-${proj.nom.toLowerCase().replace(/\s+/g,'-')}-${today()}.html`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Rapport généré ✓ Ouvre-le dans Safari pour imprimer en PDF');
}


// ─── ENTRETIEN ───────────────────────────────────────────────────────────────
function onEntretienProjetChange() {
  const pid = document.getElementById('entretien-projet').value;
  const proj = db.projets.find(p => p.id === pid);
  if (!proj) return;
  // Pré-remplir le kilométrage si déjà sauvegardé
  const saved = JSON.parse(localStorage.getItem('gt_entretien_' + pid) || '{}');
  if (saved.km) document.getElementById('ent-km').value = saved.km;
  if (saved.moteur) document.getElementById('ent-moteur').value = saved.moteur;
  if (saved.lastVidange) document.getElementById('ent-last-vidange').value = saved.lastVidange;
  if (saved.result) renderEntretienResult(saved.result);
  else document.getElementById('entretien-result').innerHTML = '';
}

async function analyserEntretien() {
  const apiKey = getApiKey();
  if (!apiKey) { toast('Configure ta clé API'); openApiKeyModal(); return; }
  const pid = document.getElementById('entretien-projet').value;
  const proj = db.projets.find(p => p.id === pid);
  if (!proj) { toast('Sélectionne un projet'); return; }
  const moteur = document.getElementById('ent-moteur').value.trim();
  if (!moteur) { toast('Rentre la motorisation'); return; }
  const km = parseInt(document.getElementById('ent-km').value) || 0;
  const lastVidange = parseInt(document.getElementById('ent-last-vidange').value) || 0;

  const btn = document.getElementById('btn-entretien-analyze');
  btn.textContent = 'Recherche en cours...'; btn.disabled = true;

  try {
    const prompt = `Tu es un expert en mécanique automobile. Voici le véhicule : ${proj.nom}${proj.annee ? ' (' + proj.annee + ')' : ''}, motorisation : ${moteur}.
Kilométrage actuel : ${km > 0 ? km + ' km' : 'inconnu'}.
Dernière vidange à : ${lastVidange > 0 ? lastVidange + ' km' : 'inconnue'}.

Réponds UNIQUEMENT en JSON valide sans markdown :
{
  "huile": {
    "spec": "ex: 5W30 ACEA C3",
    "quantite": "ex: 4.5L avec filtre",
    "marque_recommandee": "ex: Castrol Edge 5W30"
  },
  "filtres": {
    "huile": "ex: Mann W 712/95",
    "air": "ex: Mann C 30 130",
    "habitacle": "ex: Mann CU 2545",
    "carburant": "ex: Mann WK 939"
  },
  "interventions": [
    {
      "nom": "Vidange + filtre huile",
      "intervalle_km": 15000,
      "dernier_km": ${lastVidange || 0},
      "statut": "urgent|bientot|ok",
      "detail": "courte explication"
    }
  ],
  "conseils": "2-3 phrases de conseils spécifiques à ce moteur"
}
Pour les statuts: urgent = dépassé ou < 2000km, bientot = < 5000km, ok = > 5000km restants. Inclus vidange, distribution/chaîne, bougies si essence, freins, liquide de frein, filtres.`;

    const response = await fetch('https://restless-star-0f7c.paulvillemain12.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1200,
        system: 'Tu es un expert mécanique. Réponds UNIQUEMENT en JSON valide, sans markdown ni texte autour.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error('Erreur API');
    const data = await response.json();
    const rawText = data.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse invalide');
    const result = JSON.parse(jsonMatch[0]);

    // Sauvegarder localement
    localStorage.setItem('gt_entretien_' + pid, JSON.stringify({ km, moteur, lastVidange, result }));
    renderEntretienResult(result);
    toast('Analyse terminée ✓');

  } catch(e) {
    toast('Erreur: ' + e.message.slice(0, 40));
  } finally {
    btn.textContent = 'Analyser avec l'IA'; btn.disabled = false;
  }
}

function renderEntretienResult(r) {
  const el = document.getElementById('entretien-result');
  if (!r) { el.innerHTML = ''; return; }

  const statutColor = { urgent: 'var(--red)', bientot: 'var(--orange)', ok: 'var(--green)' };
  const statutLabel = { urgent: 'URGENT', bientot: 'BIENTÔT', ok: 'OK' };

  const intervsHtml = (r.interventions || []).map(i => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:0.5px solid var(--border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${statutColor[i.statut]||'var(--text3)'};flex-shrink:0;margin-top:6px;box-shadow:0 0 6px ${statutColor[i.statut]||'transparent'}"></div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500;color:var(--text)">${i.nom}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${i.detail}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Tous les ${i.intervalle_km?.toLocaleString()} km</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:${statutColor[i.statut]||'var(--text3)'};letter-spacing:1px;flex-shrink:0">${statutLabel[i.statut]||''}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="section-title" style="margin-bottom:12px">Huile moteur</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="metric-card"><div class="metric-lbl">Spécification</div><div style="font-size:15px;font-weight:600;color:var(--accent)">${r.huile?.spec || '—'}</div></div>
        <div class="metric-card"><div class="metric-lbl">Quantité</div><div style="font-size:15px;font-weight:600;color:var(--text)">${r.huile?.quantite || '—'}</div></div>
      </div>
      ${r.huile?.marque_recommandee ? `<div style="font-size:12px;color:var(--text2);margin-top:10px">Recommandé : <strong style="color:var(--text)">${r.huile.marque_recommandee}</strong></div>` : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="section-title" style="margin-bottom:12px">Références filtres</div>
      ${Object.entries(r.filtres || {}).map(([k, v]) => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)">
          <span style="font-size:13px;color:var(--text2);text-transform:capitalize">${k === 'huile' ? 'Filtre huile' : k === 'air' ? 'Filtre air' : k === 'habitacle' ? 'Filtre habitacle' : 'Filtre carburant'}</span>
          <span style="font-size:13px;font-weight:500;font-family:'Barlow Condensed',monospace;color:var(--text)">${v}</span>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="section-title" style="margin-bottom:4px">Plan d'entretien</div>
      ${intervsHtml}
    </div>

    ${r.conseils ? `<div class="card" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:8px">Conseils spécifiques</div>
      <p style="font-size:13px;color:var(--text2);line-height:1.6">${r.conseils}</p>
    </div>` : ''}
  `;
}

// ─── BACKUP / RESTORE ────────────────────────────────────────────────────────
const BACKUP_DATE_KEY = 'garagetrack_last_backup';

function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    db: db
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = today().replace(/-/g, '');
  a.href = url;
  a.download = `garagetrack-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(BACKUP_DATE_KEY, Date.now().toString());
  toast('Sauvegarde téléchargée ✓');
  closeModal('modal-backup');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const data = parsed.db || parsed;
        if (!data.projets?.length) throw new Error('Fichier invalide');
        if (!confirm('Restaurer ' + data.projets.length + ' projet(s) ?')) return;
        
        // Mettre en mémoire
        db = data;
        save(db);
        closeModal('modal-backup');
        renderProjets();
        toast(data.projets.length + ' projet(s) restauré(s) ✓');

        // Si Supabase connecté, envoyer aussi là-bas
        if (supabaseReady) {
          toast('Envoi vers Supabase...');
          for (const p of data.projets) {
            await sbFetch('projets', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
              id: p.id, nom: p.nom||'Sans nom', immat: p.immat||'', annee: p.annee||'',
              achat: p.achat||0, budget: p.budget||0, revente: p.revente||0,
              notes: p.notes||'', photo: p.photo||null,
              created_at: new Date(p.createdAt||Date.now()).toISOString()
            })});
          }
          for (const d of (data.depenses||[])) {
            await sbFetch('depenses', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
              id: d.id, projet_id: d.projetId, description: d.desc||'',
              fourn: d.fourn||'', montant: d.montant||0, cat: d.cat||'Autre',
              date_achat: d.date||today(), photo: d.photo||null
            })});
          }
          for (const s of (data.sessions||[])) {
            await sbFetch('sessions', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
              id: s.id, projet_id: s.projetId, description: s.desc||'',
              duree: s.duree||0, date_session: s.date||today(), tasks: JSON.stringify(s.tasks||[])
            })});
          }
          await loadFromSupabase();
          renderProjets();
          toast('Données sauvegardées dans Supabase ✓');
        }
      } catch(err) {
        toast('Erreur: ' + err.message.slice(0,40));
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function checkBackupReminder() {
  const last = parseInt(localStorage.getItem(BACKUP_DATE_KEY) || '0');
  const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
  const hasData = db.projets.length > 0;
  if (hasData && daysSince >= 7) {
    setTimeout(() => {
      const banner = document.getElementById('backup-banner');
      if (banner) banner.style.display = 'flex';
    }, 2000);
  }
}

function dismissBackupBanner() {
  const banner = document.getElementById('backup-banner');
  if (banner) banner.style.display = 'none';
}

function openBackupModal() {
  const last = parseInt(localStorage.getItem(BACKUP_DATE_KEY) || '0');
  const lastStr = last ? fmtDate(new Date(last).toISOString().slice(0,10)) : 'Jamais';
  document.getElementById('backup-last-date').textContent = lastStr;
  dismissBackupBanner();
  openModal('modal-backup');
}



async function forceMigrateToSupabase() {
  if (!supabaseReady) { toast('Connecte Supabase d abord'); return; }
  const local = loadLocal();
  if (!local.projets?.length) { toast('Aucune donnee locale a migrer'); return; }
  if (!confirm('Envoyer ' + local.projets.length + ' projet(s) vers Supabase ?')) return;
  toast('Migration en cours...');
  let ok = 0;
  for (const p of local.projets) {
    const res = await sbFetch('projets', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      id: p.id, nom: p.nom, immat: p.immat||'', annee: p.annee||'',
      achat: p.achat||0, budget: p.budget||0, revente: p.revente||0,
      notes: p.notes||'', photo: p.photo||null, created_at: new Date(p.createdAt||Date.now()).toISOString()
    })});
    ok++;
  }
  for (const d of (local.depenses||[])) {
    await sbFetch('depenses', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      id: d.id, projet_id: d.projetId, description: d.desc||'',
      fourn: d.fourn||'', montant: d.montant||0, cat: d.cat||'Autre',
      date_achat: d.date||today(), photo: d.photo||null
    })});
  }
  for (const s of (local.sessions||[])) {
    await sbFetch('sessions', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      id: s.id, projet_id: s.projetId, description: s.desc||'',
      duree: s.duree||0, date_session: s.date||today(), tasks: JSON.stringify(s.tasks||[])
    })});
  }
  await loadFromSupabase();
  renderProjets();
  toast(ok + ' projets migrés vers Supabase !');
}

// ─── STATUS SUPABASE ─────────────────────────────────────────────────────────
function updateStatus() {
  const el = document.getElementById('supabase-status');
  if (!el) return;
  if (supabaseReady) {
    el.style.display = 'block';
    el.style.background = '#0f2a0f';
    el.style.color = '#39d353';
    el.textContent = '● SUPABASE CONNECTÉ';
  } else if (getSupabaseUrl()) {
    el.style.display = 'block';
    el.style.background = '#2a1a0a';
    el.style.color = '#f0883e';
    el.textContent = '● HORS LIGNE — DONNÉES LOCALES';
  } else {
    el.style.display = 'block';
    el.style.background = '#1a1a1a';
    el.style.color = '#555';
    el.textContent = '● SUPABASE NON CONFIGURÉ';
  }
}

// ─── SUPABASE SETUP ──────────────────────────────────────────────────────────
function openSupabaseSetup() { openModal('modal-supabase-setup'); }

async function saveSupabaseConfig() {
  const url = document.getElementById('sb-url-input').value.trim().replace(/\/$/, '');
  const key = document.getElementById('sb-key-input').value.trim();
  if (!url || !key) { toast('Remplis les deux champs'); return; }
  localStorage.setItem(SUPABASE_URL_KEY, url);
  localStorage.setItem(SUPABASE_KEY_KEY, key);
  closeModal('modal-supabase-setup');
  toast('Connexion en cours...');
  const ok = await loadFromSupabase();
  if (ok) {
    supabaseReady = true;
    updateStatus();
    renderProjets();
    toast('Supabase connecté ✓');
  } else {
    toast('Erreur de connexion — vérifie les clés');
  }
}

// Importer un fichier JSON de sauvegarde directement dans Supabase
function importBackupToSupabase() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const data = parsed.db || parsed;
        if (!data.projets?.length) { toast('Fichier invalide'); return; }
        if (!confirm('Importer ' + data.projets.length + ' projet(s) dans Supabase ?')) return;
        toast('Import en cours...');
        for (const p of data.projets) {
          await sbFetch('projets', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
            id: p.id, nom: p.nom||'Sans nom', immat: p.immat||'', annee: p.annee||'',
            achat: p.achat||0, budget: p.budget||0, revente: p.revente||0,
            notes: p.notes||'', photo: p.photo||null,
            created_at: new Date(p.createdAt||Date.now()).toISOString()
          })});
        }
        for (const d of (data.depenses||[])) {
          await sbFetch('depenses', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
            id: d.id, projet_id: d.projetId, description: d.desc||'',
            fourn: d.fourn||'', montant: d.montant||0, cat: d.cat||'Autre',
            date_achat: d.date||today(), photo: d.photo||null
          })});
        }
        for (const s of (data.sessions||[])) {
          await sbFetch('sessions', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
            id: s.id, projet_id: s.projetId, description: s.desc||'',
            duree: s.duree||0, date_session: s.date||today(), tasks: JSON.stringify(s.tasks||[])
          })});
        }
        await loadFromSupabase();
        renderProjets();
        toast(data.projets.length + ' projets importés dans Supabase ✓');
      } catch(err) { toast('Erreur: ' + err.message.slice(0,40)); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.getElementById('dep-date').value = today();
document.getElementById('tps-date').value = today();

async function initApp() {
  document.getElementById('splash').classList.add('hidden');
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (url && key) {
    const ok = await loadFromSupabase();
    if (ok) {
      supabaseReady = true;
    } else {
      toast('Mode hors ligne');
    }
  } else {
    setTimeout(() => openModal('modal-supabase-setup'), 1500);
  }
  updateStatus();
  renderProjets();
  checkBackupReminder();
}

setTimeout(initApp, 800);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
