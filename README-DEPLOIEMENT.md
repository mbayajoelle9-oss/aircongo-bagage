# Déploiement – Air Congo, traçabilité des bagages

Architecture : `web/` sur **Vercel** → `backend/` (API Express) sur **Render** → base **MongoDB Atlas**.

```
aircongo-deploiement/
  backend/   API Node.js + Express + Mongoose
  web/       pages passager, agent, tableau de bord (statique)
```

## Ce qui a été vérifié, et ce qui ne l'a pas été

- Vérifié : la logique métier et toutes les routes (6 tests), et les trois pages dans un vrai navigateur contre ces routes.
- **Non vérifié ici** : le serveur Express et la connexion MongoDB, car les paquets n'ont pas pu être installés dans l'environnement de préparation. Ce sont deux couches fines (`src/app.js`, `src/repo.mongo.js`). Faites le test local de l'étape 0 avant le déploiement.

## 0. Test local (15 minutes, recommandé)

```
cd backend
npm install
copy .env.example .env      (sous Windows ; "cp" sous Mac/Linux)
```
Éditez `.env` : collez votre chaîne MongoDB (étape 1) et choisissez deux clés différentes.
```
npm test        # 6 tests, sans base de données
npm start       # doit afficher « API Air Congo prête sur le port 3000 »
```
Ouvrez `http://localhost:3000/api/health` : réponse `{"ok":true}`.

## 1. MongoDB Atlas

1. Créez un cluster gratuit (M0) sur cloud.mongodb.com.
2. **Database Access** : ajoutez un utilisateur avec un mot de passe long, sans caractères spéciaux (ou encodez-les dans l'URL).
3. **Network Access** : ajoutez `0.0.0.0/0`. Render gratuit n'a pas d'adresse IP fixe ; la protection repose donc sur le mot de passe.
4. **Connect → Drivers** : copiez la chaîne `mongodb+srv://...`, remplacez le mot de passe et ajoutez le nom de la base avant le `?` : `.../aircongo?retryWrites=true&w=majority`.

## 2. GitHub

Publiez le dossier `aircongo-deploiement` (avec `backend/` et `web/` à la racine) dans un dépôt GitHub, de préférence privé. Le fichier `.gitignore` empêche d'envoyer `.env`.

## 3. Render (API)

1. **New → Web Service**, choisissez le dépôt.
2. **Root Directory** : `backend`. **Build Command** : `npm install`. **Start Command** : `npm start`. Instance : Free.
3. **Environment** (variables) :

| Variable | Valeur |
| --- | --- |
| `MONGODB_URI` | la chaîne Atlas de l'étape 1 |
| `AGENT_KEY` | une clé de 12 caractères ou plus |
| `ADMIN_KEY` | une autre clé, différente |
| `FRONTEND_URL` | à remplir à l'étape 5 |
| `SEED_DEMO` | `true` (données fictives au premier démarrage) |
| `NODE_ENV` | `production` |

4. Après le déploiement, ouvrez `https://VOTRE-API.onrender.com/api/health` : réponse `{"ok":true}`.

## 4. Vercel (pages web)

1. Dans `web/config.js`, remplacez `https://VOTRE-API.onrender.com` par l'adresse Render réelle (sans `/` final), puis envoyez la modification sur GitHub.
2. **Add New → Project**, choisissez le dépôt. **Root Directory** : `web`. **Framework Preset** : Other. Aucune commande de build.
3. Déployez et notez l'adresse `https://xxxx.vercel.app`.

## 5. Autoriser le site auprès de l'API (CORS)

Sur Render, mettez `FRONTEND_URL` = l'adresse Vercel exacte (sans `/` final), puis redéployez. Sans cela, le navigateur bloque les appels.

## 6. Vérification finale

Ouvrez l'adresse Vercel. Passager : `ACG123` / `Mbemba`. Pour les écrans Agent et Tableau de bord, saisissez `AGENT_KEY` et `ADMIN_KEY`.

## Avant la présentation de jeudi

- **Render gratuit s'endort après 15 minutes** sans visite, et le réveil prend environ une minute. Ouvrez `/api/health` cinq minutes avant la démonstration.
- Le bouton « Réinitialiser la démo » du tableau de bord (actif avec `SEED_DEMO=true`) remet les données de départ.
- Testez sur le téléphone que vous apporterez, avec la connexion que vous utiliserez.

## Problèmes fréquents

| Symptôme | Cause probable |
| --- | --- |
| Les pages affichent « Serveur injoignable » | L'API dort (patientez), ou `API_URL` est faux dans `web/config.js` |
| Erreur CORS dans la console du navigateur | `FRONTEND_URL` absent ou différent de l'adresse Vercel |
| Render : `MongooseServerSelectionError` | IP non autorisée dans Atlas (étape 1.3) ou mot de passe faux |
| « Clé d'accès invalide » | Mauvaise clé saisie, ou `AGENT_KEY`/`ADMIN_KEY` modifiée sans redéploiement |
| Render : « AGENT_KEY et ADMIN_KEY sont obligatoires… » | Variable manquante, ou les deux clés sont identiques |

## Sécurité à retenir

- Ne publiez jamais `.env` ni vos clés. Changez-les après la démonstration.
- Les données sont fictives. Avant tout usage réel : `SEED_DEMO=false`, vrai paiement mobile money, intégration au système de réservation, sauvegardes Atlas et clés personnelles par agent.
- Les franchises et tarifs de `backend/src/config.js` sont des valeurs de démonstration à valider avec Air Congo.
