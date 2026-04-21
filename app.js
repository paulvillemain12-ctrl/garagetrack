'use strict';

// ─── STORE ───────────────────────────────────────────────────────────────────
const STORE_KEY = 'garagetrack_v1';
const API_KEY_STORE = 'garagetrack_apikey';

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { projets: [], depenses: [], sessions: [] }; }
  catch { return { projets: [], depenses: [], sessions: [] }; }
}
function save(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch(e) { toast('Erreur de sauvegarde'); } }

function getApiKey() { return localStorage.getItem(API_KEY_STORE) || ''; }
function saveApiKey(k) { localStorage.setItem(API_KEY_STORE, k); }

let db = load();

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
  if (!input.files[0]) { toast('Prends une photo de la facture'); return; }
  const btn = document.getElementById('btn-analyser');
  btn.textContent = 'Analyse en cours...'; btn.disabled = true;
  try {
    const photoData = await getPhotoData('dep-photo-input', 1200);
    const base64 = photoData.split(',')[1];
    const mediaType = input.files[0].type || 'image/jpeg';
    const response = await fetch('https://restless-star-0f7c.paulvillemain12.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
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
    if (!jsonMatch) { toast('Réponse illisible'); return; }
    const result = JSON.parse(jsonMatch[0]);
    if (result.erreur) { toast(result.erreur); return; }
    const produits = result.produits || [];
    if (!produits.length) { toast('Aucun produit detecte'); return; }
    if (produits.length === 1) {
      const p = produits[0];
      if (p.description) document.getElementById('dep-desc').value = p.description;
      if (p.montant) document.getElementById('dep-montant').value = p.montant;
      if (result.fournisseur) document.getElementById('dep-fourn').value = result.fournisseur;
      toast('1 produit detecte - verifie les infos');
    } else {
      openMultiProductModal(produits, result.fournisseur);
    }
  } catch (e) {
    if (e.message.includes('401')) toast('Cle API incorrecte');
    else if (e.message.includes('429')) toast('Limite atteinte');
    else toast('Erreur: ' + e.message.slice(0, 50));
  } finally { btn.textContent = "Analyser avec l'IA"; btn.disabled = false; }
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
    return `<div class="proj-card" onclick="openProjetDetail('${p.id}')">
      ${photoHtml}
      <div class="proj-card-body">
        <div class="proj-card-title">${p.nom.toUpperCase()}</div>
        <div class="proj-card-sub">${[p.immat, p.annee].filter(Boolean).join(' · ') || 'Pas d\'immat'}</div>
        <div class="proj-card-stats">
          <div class="stat"><span class="stat-val">${fmtInt(deps)}</span><span class="stat-lbl">Dépensé${budget ? ' / ' + fmtInt(budget) : ''}</span></div>
          <div class="stat"><span class="stat-val">${hrs.toFixed(1)} h</span><span class="stat-lbl">Travaillées</span></div>
          ${p.revente ? `<div class="stat"><span class="stat-val">${fmtInt(p.revente)}</span><span class="stat-lbl">Revente visée</span></div>` : ''}
        </div>
        ${budget > 0 ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div>` : ''}
      </div>
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
    <div style="display:flex;gap:8px">
      <button class="btn-secondary" style="flex:1" onclick="deleteProjet('${id}')">Supprimer</button>
      <button class="btn-primary" style="flex:2" onclick="closeModal('modal-detail-projet');navigate('depenses');setTimeout(()=>{document.getElementById('dep-projet').value='${id}';renderDepenses()},100)">Voir les dépenses</button>
    </div>`;
  openModal('modal-detail-projet');
}

async function addProjet() {
  const nom = document.getElementById('np-nom').value.trim();
  if (!nom) { toast('Donne un nom au projet !'); return; }
  const photo = await getPhotoData('proj-photo-input');
  db.projets.push({
    id: uid(), nom, photo,
    immat: document.getElementById('np-immat').value.trim(),
    annee: document.getElementById('np-annee').value.trim(),
    achat: parseFloat(document.getElementById('np-achat').value) || 0,
    budget: parseFloat(document.getElementById('np-budget').value) || 0,
    revente: parseFloat(document.getElementById('np-revente').value) || 0,
    notes: document.getElementById('np-notes').value.trim(),
    createdAt: Date.now()
  });
  save(db);
  ['np-nom','np-immat','np-annee','np-achat','np-budget','np-revente','np-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('proj-photo-preview').style.display = 'none';
  document.getElementById('proj-photo-placeholder').style.display = 'flex';
  document.getElementById('proj-photo-input').value = '';
  closeModal('modal-new-projet');
  renderProjets();
  toast('Projet créé ✓');
}

function deleteProjet(id) {
  if (!confirm('Supprimer ce projet et toutes ses données ?')) return;
  db.projets = db.projets.filter(p => p.id !== id);
  db.depenses = db.depenses.filter(d => d.projetId !== id);
  db.sessions = db.sessions.filter(s => s.projetId !== id);
  save(db);
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
  db.depenses.push({
    id: uid(), projetId: pid, photo,
    desc: document.getElementById('dep-desc').value || 'Dépense',
    fourn: document.getElementById('dep-fourn').value,
    montant, cat: document.getElementById('dep-cat').value,
    date: document.getElementById('dep-date').value || today()
  });
  save(db);
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
  save(db); renderDepenses();
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
  db.sessions.push({ id: uid(), projetId: pid, desc, duree, tasks: [], date: today() });
  save(db);
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
  db.sessions.push({
    id: uid(), projetId: pid,
    desc: document.getElementById('tps-desc').value || 'Session',
    duree, tasks: [...quickTasks],
    date: document.getElementById('tps-date').value || today()
  });
  save(db);
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
  save(db); renderTemps();
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
    ${hasMonths ? `<div class="bilan-section"><div class="bilan-title">Évolution mensuelle</div><canvas id="bilan-chart" height="120"></canvas></div>` : ''}
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
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.db || !parsed.db.projets) throw new Error('Fichier invalide');
        if (!confirm(`Restaurer ${parsed.db.projets.length} projet(s) depuis le ${fmtDate(parsed.exportedAt?.slice(0,10))} ?\n\nTes données actuelles seront remplacées.`)) return;
        db = parsed.db;
        save(db);
        closeModal('modal-backup');
        renderProjets();
        toast(`${db.projets.length} projet(s) restauré(s) ✓`);
      } catch(err) {
        toast('Fichier invalide ou corrompu');
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

// ─── INIT ────────────────────────────────────────────────────────────────────
document.getElementById('dep-date').value = today();
document.getElementById('tps-date').value = today();

setTimeout(() => {
  document.getElementById('splash').classList.add('hidden');
  renderProjets();
  checkBackupReminder();
  if (!getApiKey()) {
    setTimeout(() => toast('Configure ta clé API dans Dépenses → ⚙'), 1500);
  }
}, 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
