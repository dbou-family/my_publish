const OWNER = 'dbou-family';
const REPO = 'my_publish';
const BRANCH = 'recipes-data';
const PATH = 'bdd recette/recettes.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const headers = (token) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

async function githubFile(token) {
  const url = `${API}/contents/${encodeURIComponent(PATH).replaceAll('%2F', '/')}?ref=${BRANCH}`;
  const response = await fetch(url, { headers: headers(token) });
  if (response.status === 404) return { response, file: null };
  if (!response.ok) throw new Error(`GitHub a répondu ${response.status} en lisant les recettes.`);
  return { response, file: await response.json() };
}

export async function onRequest({ request, env }) {
  if (!env.GITHUB_TOKEN) return Response.json({ error: 'Le secret GITHUB_TOKEN manque dans Cloudflare.' }, { status: 503 });
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return new Response('Méthode non autorisée', { status: 405, headers: { Allow: 'GET, PUT' } });
  }

  try {
    const { file } = await githubFile(env.GITHUB_TOKEN);
    if (request.method === 'GET') {
      if (!file) return Response.json({ error: 'Fichier de recettes introuvable sur la branche recipes-data.' }, { status: 404 });
      const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      const recipes = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(recipes)) throw new Error('Le fichier GitHub ne contient pas une liste de recettes valide.');
      return Response.json({ recipes }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const body = await request.json();
    if (!Array.isArray(body.recipes)) return Response.json({ error: 'La liste de recettes est invalide.' }, { status: 400 });
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(body.recipes, null, 2))));
    const write = await fetch(`${API}/contents/${encodeURIComponent(PATH).replaceAll('%2F', '/')}`, {
      method: 'PUT',
      headers: { ...headers(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Mise à jour des recettes depuis BarCraft', content, branch: BRANCH, ...(file ? { sha: file.sha } : {}) }),
    });
    if (!write.ok) {
      const detail = await write.json().catch(() => ({}));
      return Response.json({ error: detail.message || `GitHub a refusé l'enregistrement (${write.status}).` }, { status: write.status });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Erreur de synchronisation avec GitHub.' }, { status: 502 });
  }
}
