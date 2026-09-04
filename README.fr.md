[English](README.md) · **Français**

# Dessons

[![Licence : CC BY-NC 4.0](https://img.shields.io/badge/Licence-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Soutenir-13C3FF?logo=kofi&logoColor=white)](https://ko-fi.com/neoyume)

*dessin + sons* — convertit une image, une vidéo ou un flux webcam en MIDI multi-pistes, exportable en `.mid` ou envoyé en temps réel dans ton DAW via un port MIDI virtuel. Pensé pour créer des loops dans Logic Pro (ou n'importe quel DAW).

Par [neoyume](https://github.com/neoyume). Contributions bienvenues.

Tourne entièrement dans le navigateur — aucun serveur, aucune dépendance, aucune donnée envoyée où que ce soit. L'image, la vidéo et le flux webcam restent sur ta machine.

L'interface est bilingue **français / anglais** : bouton `FR / EN` en haut à droite, langue détectée automatiquement au premier lancement puis mémorisée.

## Utiliser en local

Aucune installation nécessaire. Deux options :

- Double-clique sur `index.html` pour l'ouvrir directement dans ton navigateur.
- Ou lance un petit serveur local (utile si ton navigateur bloque certaines fonctionnalités en `file://` — Web MIDI ou webcam selon la config) :
  ```bash
  python3 -m http.server 8000
  ```
  puis ouvre `http://localhost:8000`.

## Utiliser en ligne (GitHub Pages)

1. Crée un repo GitHub (public) et pousse ce dossier dedans (voir commandes plus bas).
2. Dans le repo : **Settings → Pages → Source**, sélectionne la branche `main` et le dossier `/ (root)`.
3. GitHub te donne une URL du type `https://<ton-user>.github.io/<nom-du-repo>/` — accessible depuis n'importe quel appareil, y compris mobile.

## Fonctionnement

- **Source** : dépose une **image** (JPG / PNG / WebP) ou une **vidéo** (MP4 / WebM / MOV), ou active la **webcam**. Vidéo et webcam sont ré-analysées ~15 fois par seconde : les notes se recalculent en direct et, combinées à « Jouer dans Logic », la boucle MIDI évolue avec l'image qui bouge. Le bouton **Figer** capture un instant précis.
- **Contraste / Sensibilité** : contrôle quelles zones de l'image deviennent des notes. Plus la sensibilité est basse, moins il y a de notes (seules les zones les plus contrastées sont gardées).
- **Séparation en calques** : sépare l'image par couleur (teinte) ou par luminosité (ombres / tons moyens / hautes lumières). Chaque calque devient une piste MIDI indépendante, avec son propre instrument General MIDI et son propre nom. Chaque ligne a un bouton **M** (muet) et **S** (solo) pour comparer les calques à l'oreille — ça n'agit que sur l'aperçu et le Web MIDI ; l'export `.mid` garde toujours tous les calques.
- **Gamme / octave / tempo / mesures** : un axe de l'image est quantisé sur la gamme choisie (pas de fausses notes), l'autre devient le temps.
- **Sens de lecture & courbe** (boutons-icônes à côté du bouton ▶ d'aperçu) :
  - *Sens* — gauche→droite (défaut), droite→gauche, haut→bas ou bas→haut. Quel axe porte le temps, et dans quel sens la tête de lecture le parcourt.
  - *Courbe* — déforme le temps de la tête de lecture sur la boucle : *linéaire* (régulier), *accéléré*, *ralenti*, *pulsé* (dense sur le temps, aéré au milieu) ou *swing*. Même motif de notes, grooves différents. L'icône de la courbe montre déjà le placement ; les petits traits sur le bord d'attaque de l'aperçu le montrent en pleine résolution.
  - Les deux s'appliquent à l'aperçu, à la lecture temps réel **et** à l'export `.mid`.
- **Écouter l'aperçu** : le bouton **▶ Écouter l'aperçu** joue la boucle directement dans le navigateur via un petit synthé intégré (approximations grossières des familles General MIDI) — sans DAW, sans config, dans tous les navigateurs y compris Safari. Juste pour évaluer une boucle avant de l'exporter ou de l'envoyer dans Logic.
- **Export** : génère un fichier `.mid` (format 1, multi-pistes) prêt à être importé dans Logic Pro — une piste par calque est créée automatiquement à l'import.
- **Jouer dans Logic (temps réel)** : au lieu d'exporter, envoie la boucle en direct via [Web MIDI](https://developer.mozilla.org/fr/docs/Web/API/Web_MIDI_API) vers un port MIDI virtuel. Sur macOS : ouvre *Configuration audio et MIDI* → *Fenêtre* → *Afficher les périphériques MIDI* → double-clic sur *IAC Driver* → coche *L'appareil est en ligne*. Choisis ce port dans Dessons, arme une piste d'instrument dans Logic, clique **Jouer dans Logic** : la boucle tourne et tu peux l'enregistrer. Tous les réglages (contraste, gamme, tempo, instruments, sens de lecture, image de la webcam…) s'entendent immédiatement pendant la lecture, sans arrêter. Nécessite Chrome ou Edge — Safari ne supporte pas Web MIDI ; dans ce cas, utilise l'export `.mid`.

## Une piste par calque dans Logic

Dessons envoie chaque calque sur son propre canal MIDI (calque 1 → canal 1, calque 2 → canal 2…). Deux façons d'obtenir une piste Logic par calque :

**A — Démixage auto (enregistre directement sur des pistes séparées, en une passe live)**

1. `Fichier > Réglages du projet > Enregistrement` → coche **« Démixage auto par canal si enregistrement multipiste »**. Si « Réglages du projet » n'est pas dans le menu Fichier, utilise le bouton **Réglages** (icône curseurs) de la barre de contrôle → *Réglages du projet → Enregistrement*.
2. Crée tes pistes d'instrument **dans l'ordre des calques** (calque 1 → piste 1, etc.), choisis un son sur chacune.
3. Sélectionne-les toutes et **arme-les toutes** (bouton **R** rouge sur chaque — ⌥-clic pour en armer plusieurs).
4. Enregistre et lance Dessons. Logic route le canal 1 → 1ʳᵉ piste armée, canal 2 → 2ᵉ, etc.

**B — Enregistre sur une piste, puis sépare (infaillible)**

1. Enregistre toute la sortie de Dessons sur **une seule** piste d'instrument (tous les calques dans une région, sur les canaux 1 à N).
2. Clic droit sur la région → **Séparer les événements MIDI → Par canal d'événement**. Logic crée une piste par canal ; tu assignes un instrument à chacune.

La méthode A est le vrai temps réel multipiste mais elle est réputée capricieuse (ordre d'armement, pistes restées sur canal « Tous »). La méthode B, c'est une passe d'enregistrement + un clic droit — seul inconvénient : pendant l'enregistrement tu entends tout sur un seul son.

## Structure du projet

```
dessons/
├── index.html              # l'application entière (HTML + CSS + JS, un seul fichier)
├── README.md               # doc en anglais
├── README.fr.md            # doc en français (ce fichier)
├── LICENSE                 # CC BY-NC 4.0
├── CLAUDE.md               # contexte projet pour itérer avec Claude Code
└── .github/FUNDING.yml     # lien Ko-fi pour le bouton Sponsor du repo
```

## Publier sur GitHub (première fois)

Depuis ce dossier :

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/neoyume/dessons.git
git push -u origin main
```

Le repo doit exister sur GitHub au préalable, sous ce nom (créable via l'interface web, sans README ni .gitignore pour éviter un conflit à la première synchro).

## Soutenir

Dessons est gratuit, sans aucune fonctionnalité payante — jamais. S'il te sert, tu peux laisser un pourboire sur Ko-fi : **[ko-fi.com/neoyume](https://ko-fi.com/neoyume)** ☕. Sans pression.

## Contribuer

Les issues et pull requests sont les bienvenues — que ce soit pour des bugs, de nouvelles méthodes de séparation de calques, d'autres formats d'export, etc. En proposant une contribution, tu acceptes qu'elle soit sous licence CC BY-NC 4.0, comme le reste du projet.

## Licence

[CC BY-NC 4.0](LICENSE) © [neoyume](https://github.com/neoyume).

Libre d'utilisation, de modification et de partage **à des fins non
commerciales**, avec attribution. Tu ne peux **pas** vendre Dessons ni le
redistribuer (modifié ou non) comme produit ou service payant.

**La musique que tu fais avec Dessons t'appartient** — la licence couvre l'outil,
pas ce qu'il produit. Tes loops sont utilisables pour tout, sorties commerciales
comprises.
