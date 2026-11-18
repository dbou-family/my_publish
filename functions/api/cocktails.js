const REPO = 'dbou-family/my_publish';
const BRANCH = 'recipes-data';
const FILE_PATH = 'bdd recette/recettes.json';
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
  throw await githubError(response, 'GitHub ne peut pas créer la branche de recettes');
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
      if (currentResponse.status === 404) return json({ error: 'Base de cocktails absente.' }, 404);
      if (!currentResponse.ok) return json({ error: (await githubError(currentResponse, 'Lecture GitHub impossible')).message }, 502);
      const file = await currentResponse.json();
      if (!file.content) return json({ error: 'Le fichier distant est vide ou trop volumineux.' }, 502);
      const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
      const recipes = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(recipes)) return json({ error: 'Le fichier distant ne contient pas une liste de cocktails valide.' }, 502);
      return json({ sha: file.sha, recipes });
    }

    const raw = await request.text();
    if (raw.length > 1_500_000) return json({ error: 'La base de cocktails dépasse la taille autorisée.' }, 413);
    const input = JSON.parse(raw);
    if (!Array.isArray(input.recipes)) return json({ error: 'La liste de cocktails est invalide.' }, 400);
    let currentSha = null;
    if (currentResponse.ok) {
      currentSha = (await currentResponse.json()).sha;
      if (input.sha && input.sha !== currentSha) return json({ error: 'La base a changé depuis sa dernière lecture. Rechargez les recettes puis réessayez.' }, 409);
    } else if (input.sha) {
      return json({ error: 'La base a changé depuis sa dernière lecture. Rechargez les recettes puis réessayez.' }, 409);
    }

    const bytes = new TextEncoder().encode(JSON.stringify(input.recipes, null, 2));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const response = await github(`/contents/${encodedPath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Mise à jour des recettes de cocktails', content: btoa(binary), branch: BRANCH,
        ...(currentSha ? { sha: currentSha } : {})
      })
    });
    if (!response.ok) return json({ error: (await githubError(response, 'Enregistrement GitHub impossible')).message }, response.status === 409 ? 409 : 502);
    const result = await response.json();
    return json({ sha: result.content?.sha || null, recipes: input.recipes });
  } catch (error) {
    return json({ error: error.message || 'Erreur pendant la synchronisation avec GitHub.' }, 502);
  }
}
