(() => {
  const GITHUB_RECIPE_REPO = 'dbou-family/my_publish';
  // Garder les données hors de la branche publiée par GitHub Pages.
  const GITHUB_RECIPE_BRANCH = 'recipes-data';
  const GITHUB_RECIPE_PATH = 'Mon-Carnet-de-Cuisine-IA-navigateur/base de donnée des recettes/recettes.json';
  const GITHUB_TOKEN_KEY = 'mon-carnet-github-token-v1';
  const apiBase = `https://api.github.com/repos/${GITHUB_RECIPE_REPO}/contents/` +
    GITHUB_RECIPE_PATH.split('/').map(encodeURIComponent).join('/');
  let githubRecipeSha = null;
  let githubLastSynced = null;
  let githubSaveTimer = null;
  let githubSaveRunning = false;
  let githubSaveAgain = false;
  let githubPendingRemote = null;
  let githubDataBranchReady = null;

  const token = () => localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  const recipeSnapshot = () => JSON.stringify(recipes);
  const githubHeaders = () => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28' });
  async function ensureDataBranch() {
    if (githubDataBranchReady) return githubDataBranchReady;
    githubDataBranchReady = (async () => {
      const refsUrl = `https://api.github.com/repos/${GITHUB_RECIPE_REPO}/git/refs`;
      const branchRefUrl = `https://api.github.com/repos/${GITHUB_RECIPE_REPO}/git/ref/heads/${GITHUB_RECIPE_BRANCH}`;
      const branchResponse = await fetch(branchRefUrl, { headers: githubHeaders() });
      if (branchResponse.ok) return;
      if (branchResponse.status !== 404) throw await githubError(branchResponse, 'Vérification de la branche de données impossible');

      const mainResponse = await fetch(`https://api.github.com/repos/${GITHUB_RECIPE_REPO}/git/ref/heads/main`, { headers: githubHeaders() });
      if (!mainResponse.ok) throw await githubError(mainResponse, 'Lecture de la branche principale impossible');
      const mainRef = await mainResponse.json();
      const createResponse = await fetch(refsUrl, {
        method: 'POST', headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${GITHUB_RECIPE_BRANCH}`, sha: mainRef.object.sha })
      });
      if (!createResponse.ok) {
        // Une autre fenêtre peut avoir créé la branche entre les deux requêtes.
        if (createResponse.status === 422) {
          const checkResponse = await fetch(branchRefUrl, { headers: githubHeaders() });
          if (checkResponse.ok) return;
        }
        throw await githubError(createResponse, 'Création de la branche de données impossible');
      }
    })().catch(error => { githubDataBranchReady = null; throw error; });
    return githubDataBranchReady;
  }
  async function githubError(response, action) {
    let body = null;
    try { body = await response.json(); } catch { /* réponse absente ou non JSON */ }
    const parts = [`${action} (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''})`];
    if (body?.message) parts.push(body.message);
    if (Array.isArray(body?.errors)) {
      const details = body.errors.map(item => typeof item === 'string' ? item : [item.resource, item.field, item.code, item.message].filter(Boolean).join(' / ')).filter(Boolean);
      if (details.length) parts.push(`Détails : ${details.join('; ')}`);
    }
    if (body?.documentation_url) parts.push(`Documentation : ${body.documentation_url}`);
    const requestId = response.headers.get('x-github-request-id');
    if (requestId) parts.push(`Référence GitHub : ${requestId}`);
    if (response.status === 409) parts.push('Le fichier a probablement changé depuis sa dernière lecture (conflit de version/SHA). Rechargez la version distante puis réessayez.');
    if (response.status === 401 || response.status === 403) parts.push('Vérifiez les droits du jeton et son accès au dépôt.');
    return new Error(parts.join('\n'));
  }
  const encodeUtf8Base64 = value => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };
  const decodeUtf8Base64 = value => {
    const binary = atob(value.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  async function getRemote() {
    await ensureDataBranch();
    const response = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_RECIPE_BRANCH)}`, { headers: githubHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw await githubError(response, 'Lecture des recettes impossible');
    const file = await response.json();
    if (!file.content) throw new Error('Le fichier de recettes est vide ou trop volumineux pour être lu.');
    const data = JSON.parse(decodeUtf8Base64(file.content));
    if (!data || !Array.isArray(data.recipes)) throw new Error('Le fichier GitHub ne contient pas une base de recettes valide.');
    return { sha: file.sha, recipes: data.recipes };
  }

  async function putRemote(nextRecipes, sha) {
    const payload = {
      message: 'Mise à jour du carnet de recettes',
      content: encodeUtf8Base64(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), recipes: nextRecipes }, null, 2) + '\n'),
      branch: GITHUB_RECIPE_BRANCH
    };
    if (sha) payload.sha = sha;
    const response = await fetch(apiBase, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw await githubError(response, 'Enregistrement des recettes impossible');
    const result = await response.json();
    githubRecipeSha = result.content?.sha || null;
    githubLastSynced = JSON.stringify(nextRecipes);
  }

  function setStatus(label, title) {
    const text = document.querySelector('#githubSyncLabel');
    const button = document.querySelector('#githubSyncButton');
    if (text) text.textContent = label;
    if (button) {
      const synced = label === 'À jour' && githubLastSynced !== null && recipeSnapshot() === githubLastSynced;
      button.classList.toggle('is-synced', synced);
      button.classList.toggle('is-unsynced', !synced);
      if (title) button.title = title;
    }
  }

  function openSyncDialog() {
    const connected = Boolean(token());
    showDialog(`<div class="sync-content">
      <h2 id="dialogTitle">Synchroniser mes recettes</h2>
      <p class="sync-lead">Le carnet partagé est stocké dans le dépôt GitHub <b>dbou-family/my_publish</b>, sur une branche de données séparée du site. Connectez chaque ordinateur avec un jeton personnel à accès limité pour retrouver et enregistrer vos recettes.</p>
      <p class="sync-public-note"><b>À savoir :</b> ce dépôt est public. Les recettes enregistrées dans GitHub seront visibles par toute personne qui consulte le dépôt.</p>
      <label class="sync-label" for="githubTokenInput">Jeton GitHub</label>
      <input class="sync-token-input" id="githubTokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <p class="sync-help">Créez un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">jeton finement limité</a>, sélectionnez uniquement <b>dbou-family/my_publish</b> et autorisez <b>Contents : Read and write</b>. Le jeton est conservé dans le navigateur de cet ordinateur. Ne le collez jamais dans le code du site.</p>
      <div class="sync-actions">
        ${connected ? '<button class="sync-secondary" id="forgetGithubToken">Déconnecter</button>' : '<button class="sync-secondary" id="cancelGithubSync">Plus tard</button>'}
        <button class="sync-primary" id="connectGithubSync">${connected ? 'Reconnecter et synchroniser' : 'Connecter et synchroniser'}</button>
      </div>
      <p class="sync-message" id="githubSyncMessage" role="status"></p>
    </div>`);
    const input = document.querySelector('#githubTokenInput');
    if (connected) input.placeholder = 'Jeton déjà enregistré sur cet ordinateur';
    document.querySelector('#cancelGithubSync')?.addEventListener('click', closeDialog);
    document.querySelector('#forgetGithubToken')?.addEventListener('click', () => {
      localStorage.removeItem(GITHUB_TOKEN_KEY);
      githubRecipeSha = null;
      githubLastSynced = null;
      setStatus('Synchroniser', 'Mode local sur cet ordinateur');
      closeDialog();
      toast('Ordinateur déconnecté de GitHub');
    });
    document.querySelector('#connectGithubSync').addEventListener('click', async () => {
      const entered = input.value.trim();
      if (entered) localStorage.setItem(GITHUB_TOKEN_KEY, entered);
      if (!token()) {
        document.querySelector('#githubSyncMessage').textContent = 'Collez un jeton GitHub pour connecter cet ordinateur.';
        return;
      }
      const button = document.querySelector('#connectGithubSync');
      const message = document.querySelector('#githubSyncMessage');
      button.disabled = true;
      message.textContent = 'Connexion à GitHub…';
      try {
        const remote = await getRemote();
        if (remote) {
          recipes = remote.recipes;
          githubRecipeSha = remote.sha;
          githubLastSynced = recipeSnapshot();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
          render();
          setStatus('À jour', 'Recettes synchronisées avec GitHub');
          message.textContent = `${recipes.length} recette(s) chargée(s) depuis GitHub.`;
          toast('Recettes chargées depuis GitHub');
        } else {
          await putRemote(recipes, null);
          setStatus('À jour', 'Recettes enregistrées sur GitHub');
          message.textContent = `${recipes.length} recette(s) enregistrée(s) dans la base GitHub.`;
          toast('Base de recettes créée sur GitHub');
        }
        setTimeout(closeDialog, 700);
      } catch (error) {
        message.textContent = error.message || 'Connexion impossible. Vérifiez votre jeton et votre connexion Internet.';
        button.disabled = false;
        setStatus('Erreur', 'La synchronisation GitHub a échoué');
      }
    });
  }

  async function resolveRemoteConflict() {
    const pending = githubPendingRemote;
    if (!pending) return;
    githubPendingRemote = null;
    showDialog(`<div class="sync-content"><h2 id="dialogTitle">Recettes modifiées ailleurs</h2>
      <p class="sync-lead">Une autre session a enregistré une version plus récente dans GitHub. Choisissez quelle version garder sur cet ordinateur.</p>
      <div class="sync-actions"><button class="sync-secondary" id="loadGithubVersion">Charger la version GitHub</button><button class="sync-primary" id="keepLocalVersion">Garder ma version</button></div>
    </div>`);
    document.querySelector('#loadGithubVersion').onclick = () => {
      recipes = pending.recipes;
      githubRecipeSha = pending.sha;
      githubLastSynced = recipeSnapshot();
      localStorage.setItem(STORAGE_KEY, githubLastSynced);
      render();
      setStatus('À jour', 'Recettes chargées depuis GitHub');
      closeDialog();
    };
    document.querySelector('#keepLocalVersion').onclick = async () => {
      const button = document.querySelector('#keepLocalVersion');
      button.disabled = true;
      try {
        await putRemote(recipes, pending.sha);
        setStatus('À jour', 'Recettes enregistrées sur GitHub');
        closeDialog();
        toast('Votre version a remplacé celle de GitHub');
      } catch (error) {
        button.disabled = false;
        toast(error.message || 'Enregistrement impossible');
      }
    };
  }

  async function saveRemote() {
    if (!token()) return;
    if (githubSaveRunning) { githubSaveAgain = true; return; }
    githubSaveRunning = true;
    try {
      const localCopy = JSON.parse(recipeSnapshot());
      const remote = await getRemote();
      if (remote && githubLastSynced !== null && JSON.stringify(remote.recipes) !== githubLastSynced) {
        githubPendingRemote = remote;
        await resolveRemoteConflict();
        return;
      }
      await putRemote(localCopy, remote?.sha || null);
      setStatus('À jour', 'Recettes enregistrées sur GitHub');
    } catch (error) {
      setStatus('À réessayer', 'Les dernières modifications sont enregistrées sur cet ordinateur uniquement');
      toast(error.message || 'Synchronisation GitHub impossible');
    } finally {
      githubSaveRunning = false;
      if (githubSaveAgain) {
        githubSaveAgain = false;
        scheduleRemoteSave();
      }
    }
  }

  function scheduleRemoteSave() {
    if (!token()) return;
    clearTimeout(githubSaveTimer);
    setStatus('En attente…', 'Enregistrement des recettes sur GitHub');
    githubSaveTimer = setTimeout(saveRemote, 700);
  }

  const saveLocal = save;
  save = function () {
    saveLocal();
    scheduleRemoteSave();
  };

  document.querySelector('#githubSyncButton').addEventListener('click', openSyncDialog);
  if (token()) {
    setStatus('Connexion…', 'Chargement des recettes depuis GitHub');
    getRemote().then(remote => {
      if (!remote) {
        setStatus('À synchroniser', 'La base GitHub sera créée avec les recettes de cet ordinateur');
        return;
      }
      recipes = remote.recipes;
      githubRecipeSha = remote.sha;
      githubLastSynced = recipeSnapshot();
      localStorage.setItem(STORAGE_KEY, githubLastSynced);
      render();
      setStatus('À jour', 'Recettes synchronisées avec GitHub');
    }).catch(() => setStatus('Erreur', 'Cliquez pour vérifier la connexion GitHub'));
  } else {
    setStatus('Synchroniser', 'Connectez cet ordinateur à GitHub pour partager vos recettes');
  }
})();
