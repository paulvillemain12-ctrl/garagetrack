# GarageTrack — Guide d'installation

## Ce que tu as dans ce dossier
```
garagetrack/
├── index.html       ← l'app principale
├── style.css        ← le design
├── app.js           ← la logique
├── sw.js            ← cache offline
├── manifest.json    ← config PWA
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md        ← ce fichier
```

---

## ÉTAPE 1 — Créer un compte GitHub (5 min)

1. Va sur **github.com**
2. Clique "Sign up"
3. Choisis un pseudo, un email, un mot de passe
4. Valide ton email

---

## ÉTAPE 2 — Créer un repository (2 min)

1. Connecté sur GitHub, clique le **"+"** en haut à droite → "New repository"
2. Nom du repo : **garagetrack**
3. Coche **"Public"**
4. Clique "Create repository"

---

## ÉTAPE 3 — Uploader les fichiers (3 min)

1. Sur la page de ton repo, clique **"uploading an existing file"**
2. Glisse-dépose TOUS les fichiers du dossier `garagetrack/` (y compris le dossier `icons/`)
3. En bas, clique **"Commit changes"**

---

## ÉTAPE 4 — Activer GitHub Pages (2 min)

1. Dans ton repo, clique **Settings** (onglet en haut)
2. Dans le menu gauche, clique **Pages**
3. Sous "Branch", sélectionne **main** → dossier **/ (root)**
4. Clique **Save**

GitHub va afficher une URL du style :
**`https://TONPSEUDO.github.io/garagetrack`**

Attends 1-2 minutes, puis ouvre cette URL sur ton iPhone 🎉

---

## ÉTAPE 5 — Installer sur ton iPhone

1. Ouvre l'URL dans **Safari** (obligatoire, pas Chrome)
2. Clique l'icône de partage (carré avec flèche vers le haut)
3. Appuie sur **"Sur l'écran d'accueil"**
4. Appuie sur **"Ajouter"**

L'app apparaît sur ton écran d'accueil comme une vraie app native !

---

## Pour mettre à jour l'app

Quand Claude t'envoie des fichiers mis à jour :
1. Va sur github.com → ton repo garagetrack
2. Clique sur le fichier à remplacer (ex: `app.js`)
3. Clique l'icône crayon ✏️
4. Remplace le contenu → "Commit changes"

---

## Questions fréquentes

**Les données sont perdues si je supprime l'app ?**
→ Oui, les données sont stockées dans le navigateur Safari. Pour plus de sécurité, on pourra ajouter un export JSON plus tard.

**Ça marche sans internet ?**
→ Oui ! L'app se charge en offline une fois que tu l'as ouverte au moins une fois en ligne.

**Peut-on avoir plusieurs utilisateurs ?**
→ Non pour l'instant, c'est personnel. On pourra évoluer vers ça si besoin.
