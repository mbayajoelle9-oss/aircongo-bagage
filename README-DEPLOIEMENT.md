# Air Congo – Traçabilité des bagages : mise à jour (version avec connexion)

## 1. Variables d'environnement sur Render (Environment)
Supprimez AGENT_KEY et ADMIN_KEY. Ajoutez / vérifiez :

| Nom | Valeur |
|---|---|
| MONGODB_URI | (déjà en place) |
| JWT_SECRET | texte aléatoire de 32 caractères minimum (voir ci-dessous) |
| ADMIN_EMAIL | votre e-mail de connexion administrateur |
| ADMIN_PASSWORD | mot de passe de 10 caractères minimum |
| ADMIN_NAME | Gad Nsimba (facultatif) |
| FRONTEND_URL | https://aircongo-bagages.vercel.app (sans « / » final) |
| SEED_DEMO | true (pour la démonstration) |

Générer JWT_SECRET (PowerShell) :
    -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})

Ne communiquez jamais ces valeurs à personne. Le compte administrateur est créé au premier démarrage ; changez ensuite son mot de passe depuis Utilisateurs.

## 2. Envoyer le code
    git add .
    git commit -m "Application avec connexion et interface moderne"
    git push
Render redéploie seul (2–3 min).

## 3. Mettre à jour le site web (Vercel)
Vérifiez web/config.js : API_URL = https://aircongo-bagage.onrender.com
    cd web
    vercel --prod

## 4. Avant la démonstration
- Ouvrez https://aircongo-bagage.onrender.com/api/health (réveille le serveur, ~1 min).
- Connectez-vous en administrateur, créez un compte Agent (station FIH) depuis Utilisateurs.
- Passager de démo : ACG123 / Mbemba — VIP : ACV777 / Kabila — Business : ACB456 / Tshimanga.

## Nouveautés de cette version
- Les étiquettes (code + QR) sont émises par le personnel (bouton « Nouvelle étiquette »), jamais par le passager.
- Cartographie du trajet de chaque bagage (scan et RFID), côté passager et côté administration.
- Alertes passager à chaque scan (SMS, WhatsApp ou portail). L'envoi réel de SMS/WhatsApp nécessite un fournisseur : simulé pour l'instant.
- Chaque point de passage est une station : liste dans backend/src/config.js (STATIONS). Le compte d'un agent doit utiliser l'un de ces codes.
- Après mise à jour : SEED_DEMO=true recharge les données de démonstration seulement si la base est vide ; pour les recharger, connectez-vous en administrateur puis POST /api/admin/demo/reset.

## Carte OpenStreetMap et points de scan
- Chaque point où un bagage est scanné (comptoir, tri, chargement, soute d'arrivée, tapis de remise…) a ses coordonnées GPS. L'agent choisit son point avant de scanner : le point décide de l'étape et de la station.
- L'administrateur gère les points dans « Carte & points » (nom, aéroport, étape, GPS, portique RFID, actif). Dans « Ma position », le navigateur relève le GPS de l'endroit où l'on se trouve : allez à chaque point avec un téléphone.
- Les points créés au premier démarrage sont des positions de DÉMONSTRATION près de chaque aéroport (marquées « à confirmer sur place ») : à remplacer par les vraies coordonnées avant la présentation si possible.
- Le passager et l'administrateur voient le même chemin sur la carte. Un bagage déjà scanné AVANT cette mise à jour n'a pas de coordonnées : il n'apparaît pas sur la carte (rechargez la démo : POST /api/admin/demo/reset, ou « Réinitialiser » avec SEED_DEMO=true).
- La carte utilise Leaflet (chargé depuis unpkg.com) et les tuiles de tile.openstreetmap.org. Pour ne pas dépendre de unpkg : copiez leaflet.js, leaflet.css et le dossier images dans web/vendor/ (npm pack leaflet, puis dossier dist). Pour une utilisation commerciale intensive, prévoir un fournisseur de tuiles dédié (la politique d'usage d'OpenStreetMap limite le trafic).
