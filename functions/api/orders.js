const REPO = 'dbou-family/my_publish';
const BRANCH = 'recipes-data';
const FILE_PATH = 'bdd recette/commandes.json';
const STATUS_PATH = 'bdd recette/etat-bar.json';
const GH = `https://api.github.com/repos/${REPO}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function github(path, token, options = {}) {
  return fetch(`${GH}${path}`, { ...options, headers: {
    Accept: 'application/vnd.github+json', 'User-Agent': 'BarCraft', Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers
  }});
}

async function ensureBranch(token) {
  let response = await github(`/git/ref/heads/${BRANCH}`, token);
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`GitHub indisponible (${response.status}).`);
  response = await github('/git/ref/heads/main', token);
  if (!response.ok) throw new Error('Impossible de lire la branche main.');
  const main = await response.json();
  response = await github('/git/refs', token, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: main.object.sha }) });
  if (!response.ok && response.status !== 422) throw new Error('Impossible de créer la branche de données.');
}

async function readOrders(token) {
  const path = `/contents/${FILE_PATH.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH)}`;
  const response = await github(path, token);
  if (response.status === 404) return { orders: [], sha: null };
  if (!response.ok) throw new Error(`Lecture des commandes impossible (${response.status}).`);
  const file = await response.json();
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
  const orders = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(orders)) throw new Error('Le fichier des commandes est invalide.');
  return { orders, sha: file.sha };
}

async function writeOrders(token, orders, sha) {
  const encodedPath = FILE_PATH.split('/').map(encodeURIComponent).join('/');
  const bytes = new TextEncoder().encode(JSON.stringify(orders, null, 2));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return github(`/contents/${encodedPath}`, token, { method: 'PUT', body: JSON.stringify({
    message: 'Mise à jour des commandes BarCraft', content: btoa(binary), branch: BRANCH, ...(sha ? { sha } : {})
  }) });
}

async function readBarStatus(token) {
  const path = `/contents/${STATUS_PATH.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH)}`;
  const response = await github(path, token);
  if (response.status === 404) return { open: true, sha: null };
  if (!response.ok) throw new Error(`Lecture de l’état du bar impossible (${response.status}).`);
  const file = await response.json();
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
  const status = JSON.parse(new TextDecoder().decode(bytes));
  return { open: status.open !== false, sha: file.sha };
}

async function writeBarStatus(token, open, sha) {
  const encodedPath = STATUS_PATH.split('/').map(encodeURIComponent).join('/');
  const bytes = new TextEncoder().encode(JSON.stringify({ open, updatedAt: new Date().toISOString() }, null, 2));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return github(`/contents/${encodedPath}`, token, { method: 'PUT', body: JSON.stringify({
    message: `BarCraft : ${open ? 'ouverture' : 'fermeture'} du bar`, content: btoa(binary), branch: BRANCH, ...(sha ? { sha } : {})
  }) });
}

export async function onRequest({ request, env }) {
  if (!env.GITHUB_TOKEN) return json({ error: 'Le secret GITHUB_TOKEN n’est pas configuré dans Cloudflare.' }, 503);
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) return json({ error: 'Méthode non autorisée.' }, 405);
  try {
    const token = env.GITHUB_TOKEN;
    await ensureBranch(token);
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.get('barStatus') === '1') {
        const status = await readBarStatus(token);
        return json({ open: status.open });
      }
      const { orders } = await readOrders(token);
      const guestId = new URL(request.url).searchParams.get('guestId');
      return json({ orders: guestId ? orders.filter(order => order.guestId === guestId) : orders });
    }
    const body = await request.json();
    if (request.method === 'PATCH' && body.action === 'barStatus') {
      if (!env.BAR_ADMIN_PIN) return json({ error: 'Configurez le secret BAR_ADMIN_PIN dans Cloudflare pour gérer l’ouverture du bar.' }, 503);
      const suppliedPin = request.headers.get('X-Bar-Admin-Pin') || '';
      if (suppliedPin !== env.BAR_ADMIN_PIN) return json({ error: 'Code barman incorrect.' }, 403);
      const open = body.open === true;
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await readBarStatus(token);
        const response = await writeBarStatus(token, open, current.sha);
        if (response.ok) return json({ open });
        if (response.status !== 409 && response.status !== 422) return json({ error: `Mise à jour de l’état impossible (${response.status}).` }, 502);
      }
      return json({ error: 'L’état du bar vient de changer. Réessayez.' }, 409);
    }
    if (request.method === 'POST') {
      const barStatus = await readBarStatus(token);
      if (!barStatus.open) return json({ error: 'Le bar est fermé et ne prend plus de commandes.' }, 423);
      const pseudo = String(body.pseudo || '').trim().slice(0, 40);
      const cocktail = String(body.cocktail || '').trim().slice(0, 100);
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients.map(item => String(item).slice(0, 120)).slice(0, 30) : [];
      const guestId = String(body.guestId || '').trim().slice(0, 80);
      if (!pseudo || !cocktail || !ingredients.length || !guestId) return json({ error: 'Pseudo, cocktail, ingrédients et identifiant invité sont requis.' }, 400);
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await readOrders(token);
        const order = { id: crypto.randomUUID(), guestId, pseudo, cocktail, ingredients, status: 'pending', createdAt: new Date().toISOString() };
        const response = await writeOrders(token, [...current.orders, order], current.sha);
        if (response.ok) return json({ order }, 201);
        if (response.status !== 409 && response.status !== 422) return json({ error: `Enregistrement GitHub impossible (${response.status}).` }, 502);
      }
      return json({ error: 'Plusieurs commandes arrivent en même temps. Réessayez.' }, 409);
    }
    const id = String(body.id || '');
    if (!id) return json({ error: 'Identifiant de commande manquant.' }, 400);
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await readOrders(token);
      const order = current.orders.find(item => item.id === id);
      if (!order) return json({ error: 'Commande introuvable.' }, 404);
      order.status = body.status === 'pending' ? 'pending' : 'completed';
      order.completedAt = order.status === 'completed' ? new Date().toISOString() : null;
      const response = await writeOrders(token, current.orders, current.sha);
      if (response.ok) return json({ order });
      if (response.status !== 409 && response.status !== 422) return json({ error: `Mise à jour GitHub impossible (${response.status}).` }, 502);
    }
    return json({ error: 'Les commandes viennent de changer. Rechargez la page et réessayez.' }, 409);
  } catch (error) { return json({ error: error.message || 'Erreur commandes.' }, 502); }
}
