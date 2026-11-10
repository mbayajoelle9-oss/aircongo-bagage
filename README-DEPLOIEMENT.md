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
