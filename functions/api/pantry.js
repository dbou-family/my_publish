const REPO = 'dbou-family/my_publish';
const BRANCH = 'recipes-data';
const FILE_PATH = 'bdd recette/ingredients-du-bar.json';
const GH = `https://api.github.com/repos/${REPO}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function github(path, token, options = {}) {
  return fetch(`${GH}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BarCraft',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
}

async function githubError(response, action) {
  let body = {};
  try { body = await response.json(); } catch { /* réponse non JSON */ }
  const details = [body.message, body.documentation_url].filter(Boolean).join(' — ');
  return new Error(`${action} (HTTP ${response.status})${details ? ` : ${details}` : ''}`);
}

async function ensureBranch(token) {
  let response = await github(`/git/ref/heads/${BRANCH}`, token);
  if (response.ok) return;
  if (response.status !== 404) throw await githubError(response, 'GitHub ne peut pas vérifier la branche');
  response = await github('/git/ref/heads/main', token);
  if (!response.ok) throw await githubError(response, 'GitHub ne peut pas lire main');
  const main = await response.json();
  response = await github('/git/refs', token, {
    method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: main.object.sha })
  });
  if (response.ok || response.status === 422) return;
  throw await githubError(response, 'GitHub ne peut pas créer la branche de données');
}

export async function onRequest({ request, env }) {
  if (!env.GITHUB_TOKEN) return json({ error: 'Le secret GITHUB_TOKEN n’est pas configuré dans Cloudflare.' }, 503);
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'Méthode non autorisée.' }, 405);

  try {
    const token = env.GITHUB_TOKEN;
    await ensureBranch(token);
    const encodedPath = FILE_PATH.split('/').map(encodeURIComponent).join('/');
    const fileUrl = `/contents/${encodedPath}?ref=${encodeURIComponent(BRANCH)}`;
    const currentResponse = await github(fileUrl, token);

    if (request.method === 'GET') {
      if (currentResponse.status === 404) return json({ error: 'Liste des ingrédients absente.' }, 404);
      if (!currentResponse.ok) return json({ error: (await githubError(currentResponse, 'Lecture GitHub impossible')).message }, 502);
      const file = await currentResponse.json();
      if (!file.content) return json({ error: 'Le fichier GitHub est vide ou trop volumineux.' }, 502);
      const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(data.pantry)) return json({ error: 'Le fichier GitHub ne contient pas une liste d’ingrédients valide.' }, 502);
      return json({ sha: file.sha, pantry: data.pantry });
    }

    const raw = await request.text();
    if (raw.length > 100_000) return json({ error: 'La liste d’ingrédients dépasse la taille autorisée.' }, 413);
    const input = JSON.parse(raw);
    const validPantryItem = item => {
      if (typeof item === 'string') return Boolean(item.trim()) && item.length <= 100;
      return item && typeof item === 'object' && !Array.isArray(item)
        && typeof item.name === 'string' && Boolean(item.name.trim()) && item.name.length <= 100
        && (item.image === undefined || (typeof item.image === 'string' && item.image.length <= 2048 && /^https?:\/\/\S+$/i.test(item.image)));
    };
    if (!Array.isArray(input.pantry) || input.pantry.some(item => !validPantryItem(item))) {
      return json({ error: 'La liste d’ingrédients est invalide.' }, 400);
    }
    let currentSha = null;
    if (currentResponse.ok) {
      currentSha = (await currentResponse.json()).sha;
      if (input.sha !== currentSha) return json({ error: 'La liste du bar a changé dans GitHub. Rechargez la synchronisation puis réessayez.' }, 409);
    } else if (currentResponse.status !== 404) {
      return json({ error: (await githubError(currentResponse, 'Lecture GitHub impossible')).message }, 502);
    } else if (input.sha) {
      return json({ error: 'La liste du bar a changé dans GitHub. Rechargez la synchronisation puis réessayez.' }, 409);
    }

    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), pantry: input.pantry }, null, 2) + '\n');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const response = await github(`/contents/${encodedPath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Mise à jour des ingrédients du bar', content: btoa(binary), branch: BRANCH,
        ...(currentSha ? { sha: currentSha } : {})
      })
    });
    if (!response.ok) return json({ error: (await githubError(response, 'Enregistrement GitHub impossible')).message }, response.status === 409 ? 409 : 502);
    const result = await response.json();
    return json({ sha: result.content?.sha || null, pantry: input.pantry });
  } catch (error) {
    return json({ error: error.message || 'Erreur pendant la synchronisation des ingrédients avec GitHub.' }, 502);
  }
}
