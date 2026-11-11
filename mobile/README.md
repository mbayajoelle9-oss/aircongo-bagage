# Application Android Air Congo (APK)

Enveloppe native (Expo + WebView) autour du site : agents et passagers se connectent depuis l'application,
avec la caméra pour scanner. Le site Vercel reste la seule source de vérité : toute mise à jour du site est
visible dans l'application sans reconstruire l'APK.

## Construire l'APK (≈ 15 min, aucun Android Studio nécessaire)

1. Ouvrez `config.js` et mettez l'adresse de votre site Vercel (déjà réglée sur `https://aircongo-bagages.vercel.app`).
2. Dans ce dossier `mobile`, avec un compte Expo :

```
npm install
npx expo install --fix
npx eas login
npx eas build --platform android --profile preview
```

3. EAS affiche un lien de téléchargement de l'**APK** : ouvrez-le sur le téléphone (autoriser « sources inconnues »), installez.

## À vérifier sur un vrai téléphone (non testé ici)

- L'APK n'a pas pu être construit ni lancé dans l'environnement où ce code a été écrit : le premier build peut demander un ajustement de versions (`npx expo install --fix` s'en charge normalement).
- Scan par caméra : dépend de la prise en charge du lecteur de codes du WebView du téléphone. Un lecteur de codes-barres de poche ou un PDA (qui « tape » le code comme un clavier) fonctionne dans tous les cas, de même que la saisie manuelle du code.
- Pour la Play Store, utiliser `--profile production` (format .aab) ; icône : remplacer `assets/` par un logo en haute résolution.
