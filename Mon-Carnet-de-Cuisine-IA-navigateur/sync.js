(() => {
  const GITHUB_RECIPE_REPO = 'dbou-family/my_publish';
  const apiBase = '../api/recipes';
  let githubRecipeSha = null;
  let githubLastSynced = null;
  let githubSaveTimer = null;
  let githubSaveRunning = false;
  let githubSaveAgain = false;
  let githubPendingRemote = null;

  const token = () => true; // Le jeton reste côté serveur dans Cloudflare.
  const recipeSnapshot = () => JSON.stringify(recipes);
  async function apiError(response, action) {
    let body = null;
    try { body = await response.json(); } catch { /* réponse absente ou non JSON */ }
    return new Error(body?.error || `${action} (HTTP ${response.status})`);
  }
  async function getRemote() {
    const response = await fetch(apiBase);
    if (response.status === 404) return null;
    if (!response.ok) throw await apiError(response, 'Lecture des recettes impossible');
    const file = await response.json();
    if (!Array.isArray(file.recipes)) throw new Error('La base distante ne contient pas une liste de recettes valide.');
    return file;
  }

  async function putRemote(nextRecipes, sha) {
    const payload = {
      recipes: nextRecipes
    };
    if (sha) payload.sha = sha;
    const response = await fetch(apiBase, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw await apiError(response, 'Enregistrement des recettes impossible');
    const result = await response.json();
    githubRecipeSha = result.sha || null;
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
      <p class="sync-lead">Le carnet partagé est stocké dans le dépôt GitHub <b>dbou-family/my_publish</b>, sur une branche séparée du site. La connexion utilise le jeton configuré dans Cloudflare.</p>
      <p class="sync-public-note"><b>À savoir :</b> ce dépôt est public. Les recettes enregistrées dans GitHub seront visibles par toute personne qui consulte le dépôt.</p>
      <p class="sync-help">Le jeton reste côté serveur et n’est jamais envoyé au navigateur.</p>
      <div class="sync-actions">
        <button class="sync-secondary" id="cancelGithubSync">Fermer</button>
        <button class="sync-primary" id="connectGithubSync">Synchroniser</button>
      </div>
      <p class="sync-message" id="githubSyncMessage" role="status"></p>
    </div>`);
    document.querySelector('#cancelGithubSync')?.addEventListener('click', closeDialog);
    document.querySelector('#connectGithubSync').addEventListener('click', async () => {
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
