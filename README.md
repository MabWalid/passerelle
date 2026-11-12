# Passerelle

> Carte de fidélité digitale pour Apple Wallet et Google Wallet, personnalisable par enseigne (white-label).
> Chaque enseigne se configure dans `brands.json` : nom, couleur, points par euro, récompense.

Génère une carte de fidélité (pass) pour **Apple Wallet** et **Google Wallet** à partir d'un numéro de carte.
Le dos du pass affiche les derniers tickets de caisse digitaux ; un compteur montre le papier économisé.

## Lancer en local
Node.js 22.5 ou plus (SQLite est intégré au runtime).
```bash
npm install
cp .env.example .env     # puis remplir les valeurs
npm run dev              # http://localhost:3000
```
L'aperçu et l'export JSON fonctionnent sans configuration.
Les cartes et les tickets sont enregistrés dans `data/passerelle.sqlite` (ignoré par git) et survivent à un redémarrage. Supprimer ce fichier revient à la carte de démonstration.
Tant que `PASSE_API_KEY` est vide, la caisse est ouverte : pratique sur un Wi-Fi de confiance. Avec une valeur, le studio et la caisse doivent envoyer `Authorization: Bearer`. La carte sur le téléphone continue de se lire sans cette clé.

## Démo live (0 €, sans certificat)
1. `npm run dev` : le terminal affiche l'adresse à ouvrir sur l'iPhone (même Wi-Fi).
2. iPhone : ouvrir `http://IP-DU-PC:3000/carte.html?n=3012345678905`, puis Partager → *Sur l'écran d'accueil* (mode plein écran).
3. PC : ouvrir `/caisse.html` et cliquer *Passer en caisse* : la carte se met à jour en direct sur le téléphone, avec une bannière façon notification.
Sans Wi-Fi commun : `cloudflared tunnel --url http://localhost:3000` (gratuit) donne une adresse https publique temporaire.
Cette démo reproduit le comportement des passes (mise à jour à distance, notification, ticket au dos). Les vrais passes demandent les certificats ci-dessous.

## Apple Wallet (.pkpass)
1. Compte Apple Developer → créer un **Pass Type ID** et un certificat.
2. Exporter en PEM dans `certs/` : `signerCert.pem`, `signerKey.pem`, et le certificat Apple WWDR `wwdr.pem`.
3. Renseigner `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID` (et la passphrase) dans `.env`.

## Google Wallet
1. Google Cloud : activer l'API Google Wallet, créer un compte de service, télécharger sa clé JSON dans `certs/google-service-account.json`.
2. Console Google Wallet : récupérer l'**Issuer ID** → `GOOGLE_ISSUER_ID` dans `.env`.

## Feuille de route
- [x] Étape 1 : aperçu + export JSON
- [x] Étape 2 : serveur de signature (.pkpass) et lien Google Wallet
- [x] Étape 3 (démo) : mise à jour en direct + notification simulée
- [ ] Étape 3 (réel) : web service Apple + APNs, PATCH Google (nécessite les certificats)
- [ ] Étape 4 : tickets réels via l'API de l'enseigne cliente, tests, déploiement
