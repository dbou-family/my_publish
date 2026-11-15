# Mon Carnet de Cuisine

Prototype web interactif en français pour organiser, consulter et enrichir ses recettes.

## Consulter le prototype

Ouvrez `index.html` pour parcourir le carnet. Les fonctions classiques sont disponibles sans installation. Pour utiliser l’IA, le prototype doit être servi depuis une adresse HTTPS (par exemple GitHub Pages) : les navigateurs bloquent les modules et modèles distants depuis un fichier local. Aucun serveur à installer n’est nécessaire.

## Fonctions

- Recherche, filtres par catégorie et par durée, et favoris.
- Fiches détaillées avec portions, ingrédients et étapes.
- Ajout, édition et suppression de recettes.
- Extraction de texte visible sur une photo ou de texte de recette fourni.
- Recherche d’image Openverse quand une recette est enregistrée sans photo, avec crédit et licence quand disponibles.

Par défaut, les recettes et favoris sont conservés dans le stockage local du navigateur sur cet appareil. Le bouton **Synchroniser** permet de partager le carnet entre plusieurs ordinateurs avec le dépôt GitHub `dbou-family/my_publish`. Il faut connecter chaque navigateur avec un jeton finement limité à ce dépôt et autorisant `Contents: Read and write`. Le jeton reste dans le stockage local de ce navigateur.

La base partagée est enregistrée dans `base de donnée des recettes/recettes.json`. Le dépôt GitHub est public : les recettes qui y sont synchronisées sont visibles publiquement. Sans connexion GitHub, l’application continue de fonctionner en mode local.

## IA sans clé API ni installation

Au premier clic sur le bouton grisé « Préparer l’IA », l’application explique le téléchargement depuis jsDelivr et Hugging Face et demande l’accord de l’utilisateur. Sans accord, rien n’est téléchargé et le bouton reste grisé. Après acceptation, une barre indique la progression du chargement de Transformers.js et du modèle vision SmolVLM-256M, dans un worker du navigateur. À la fin, une confirmation s’affiche et le bouton « Générer avec l’IA » devient disponible. Le navigateur conserve le moteur et le modèle en cache.

L’inférence se fait sur l’appareil via WebGPU ; il faut un navigateur récent compatible et une connexion Internet pour le premier chargement. Les performances et la qualité, notamment en français, peuvent varier selon l’ordinateur et le navigateur.

Depuis l’onglet Photo, le modèle observe un plat et propose une recette plausible (ingrédients, quantités, étapes, durée et portions). Les ingrédients cachés et la préparation réelle ne sont pas vérifiables depuis l’image : la proposition les signale comme incertains. Relisez et adaptez toujours la fiche avant de cuisiner. L’onglet Texte permet de coller une recette à extraire fidèlement.

Pour un site ou une vidéo TikTok, indiquez le lien comme référence et collez le texte de la recette, la transcription ou les sous-titres. Les navigateurs empêchent généralement une page locale de lire le contenu d’un autre site ; l’application n’essaie donc pas de contourner ces protections. Aucun contenu TikTok n’est transcrit automatiquement.

## Modifier les recettes de démonstration

Les exemples sont définis dans `app.js`, au début du fichier, dans `seedRecipes`. Un objet recette contient `id`, `name`, `category`, `time` (minutes), `servings`, `difficulty`, `image` (URL), `description`, `ingredients` (tableaux `[nom, quantité]`), `steps` (liste de textes) et `favorite` (booléen). Pour réinitialiser les exemples, effacez la donnée `mon-carnet-recettes-v1` dans le stockage local du navigateur.

## Structure

- `index.html` : page et structure des vues.
- `styles.css` : présentation responsive.
- `app.js` : carnet, recettes et stockage local.
- `ai.js` : interface IA et recherche d’images Openverse.
- `model-worker.js` : chargement et exécution du modèle dans le navigateur.
