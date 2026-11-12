# Air Congo Bagages — application mobile NATIVE (React Native / Expo)
(Expo SDK 54, compatible Expo Go 54.0.8)

Application pour **agents** et **passagers**. Elle ne dépend PAS du site web : elle parle directement à l'API
(`https://aircongo-bagage.onrender.com`, voir `src/api.js`). Les administrateurs utilisent la console web.

## Écrans
- **Connexion** : Passager (PNR + nom) ou Agent (e-mail + mot de passe). Session gardée dans SecureStore.
- **Passager** : Bagages (frise + points de passage, mise à jour auto toutes les 8 s, paiement excédent, signalement),
  Radar (avions animés en continu sur carte OpenStreetMap, pastille 🧳 de ses bagages, suivi en direct, achat d'espace Mobile Money simulé),
  Réclamation bagage (nom, vol, date, PNR, billet — VIP prioritaire — + suivi), Alertes.
- **Agent** : Scanner (caméra QR/code-barres + saisie, choix du point, poids), Radar (démo ×60, bagages à bord), Passagers (réservation + étiquette), Réclamations.

## Lancer / construire
```
cd mobile
npm install
npx expo install --fix      # aligne les versions des paquets sur Expo SDK 54
npx expo start              # test rapide avec Expo Go (scan du QR code)
npx eas build --platform android --profile preview   # génère l'APK
```
## Important
- Code écrit sans pouvoir l'exécuter sur un téléphone : syntaxe vérifiée, mais **à tester** (caméra, carte) avant la réunion.
- La carte utilise Leaflet + tuiles OpenStreetMap chargés par internet dans une WebView (aucune clé requise).
- Mobile Money et SMS/WhatsApp : simulés (phase 2 : agrégateur réel).
