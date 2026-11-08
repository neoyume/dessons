# Dessons — contexte projet

Outil web qui convertit une image, une vidéo, un flux webcam ou une peinture en direct en MIDI multi-pistes : export `.mid`, ou lecture temps réel via Web MIDI vers un port virtuel (IAC Driver sur macOS) pour Logic Pro. Peut aussi rendre la boucle ou le replay d'un dessin en vidéo 9:16. Nom : contraction de « dessin » et « sons ». Publié : https://github.com/neoyume/dessons

Tout tourne dans le navigateur : aucune donnée envoyée à un serveur, publié tel quel sur GitHub Pages. Interface bilingue FR/EN (`dessons.lang` dans `localStorage`, partagé entre les pages).

## Où chercher

Lire la note concernée **avant** de toucher à une partie : elle explique les choix et les pièges fonction par fonction.

| Fichier | Rôle | Notes |
|---|---|---|
| `index.html` | L'atelier : analyse, calques, presets, Web MIDI, export vidéo | [docs/notes/atelier.md](docs/notes/atelier.md) |
| `nodes.html` | Version modulaire : graphe de nodes, signaux, node Logic, mesh, MIDI | [docs/notes/nodes.md](docs/notes/nodes.md) |
| `nodes.html?draw` | Le Dessin : pinceau, pages, instruments, Pixel, animation, zoom | [docs/notes/dessin.md](docs/notes/dessin.md) |
| `compose.html` | Arrangeur de scènes, **en stand-by** depuis le 2026-11-05 : marche par son URL, plus aucun lien n'y mène | [docs/notes/chanson.md](docs/notes/chanson.md) |
| `dessons-core.js` | Code partagé, voir plus bas | |
| `tests/index.html` | Tests, voir plus bas | |

Une fonction ajoutée ou un piège trouvé va dans la note de sa partie. Ici, seulement ce qui vaut pour tout le projet ou ce dont l'oubli casse quelque chose sans bruit.

## Principes

- **Pas de framework, pas de bundler** : le projet reste « ouvre et ça marche », copiable, forkable sans setup. `dessons-core.js` est un `<script src>` classique, **pas un module ES** (`type="module"` est bloqué en `file://`) : ses fonctions sont des globales.
- **Encodage MIDI écrit à la main** (SMF type 1, `writeVarLen`, `buildMidi`) : aucune dépendance, contrôle total du fichier.
- **Détection par contours, pas par pixel brut** : seul un gradient de luminosité au-dessus d'un seuil devient une note. C'est ce qui rend le résultat musical.
- **Calques → pistes** : chaque calque (teinte, luminosité, couleurs pipettées, orientation Sobel) est une piste MIDI avec son canal et son instrument. C'est la fonctionnalité qui distingue le projet.
- **Grille temps × hauteur** : `steps` divisions × une voie par degré de la gamme. Pas de micro-notes injouables, et jamais de fausse note.
- **`.mid` = le document complet** : mute/solo n'affectent que la lecture temps réel et l'aperçu, `buildMidi()` écrit toujours tous les calques. La courbe de lecture, elle, est écrite dans le `.mid`.
- **Une note `{step, midi, vel}` ne connaît pas la direction** : `step` = ordre de lecture, l'export et le scheduler le consomment tel quel. Seuls `process()` (`fwd`) et l'affichage (`inv`) tiennent compte du sens.
- **Un seul moteur de transport, deux sorties** (`sink` : `midi` ou `synth`), planification juste-à-temps : 25 ms, lookahead 150 ms, réglages relus à chaque pas.
- **Réutiliser le pipeline existant** : les contrôles visuels (bande d'octaves, courbe de tons) écrivent dans les inputs cachés puis font `dispatchEvent('input')`. Presets et remise à zéro n'ont rien à savoir d'eux.
- **Don optionnel uniquement** : ne jamais conditionner une fonction à un paiement.

## Ce qu'il faut éviter de casser

- Le zéro-dépendance / zéro-build : ne pas introduire npm/webpack sans que ce soit une décision explicite et assumée avec l'utilisateur
- Le fait que ça reste utilisable en `file://` direct (double-clic) en plus de GitHub Pages
- La logique de gamme (aucune note hors gamme ne doit pouvoir sortir) — c'est un principe central du projet, pas un détail
- Le fait que l'export `.mid` marche sans Web MIDI : le mode temps réel est un bonus, jamais un prérequis. Si `navigator.requestMIDIAccess` est absent, le reste doit fonctionner normalement (seul le bouton « Jouer dans le DAW » est désactivé, avec l'alerte `#midiWarn`). Idem webcam : si `getUserMedia` manque, image + vidéo doivent marcher.
- Pas de notes bloquées : tout ajout au scheduler temps réel doit garantir un note-off correspondant, et `stopPlayback()` doit rester le filet de sécurité (clear + note-off explicites + CC 123).
- La parité FR/EN : toute nouvelle chaîne visible passe par `I18N` (les deux langues) ou `[data-i18n]`, jamais en dur. `t()` pour le JS. Vérifier que `Object.keys(I18N.fr)` == `Object.keys(I18N.en)` — dans **les trois** pages (`compose.html` et `nodes.html` ont chacune leur propre dictionnaire, la langue est partagée via `dessons.lang`).
- Le nettoyage des sources : toujours passer par `stopSource()` avant d'en démarrer une autre (sinon caméra qui reste allumée, timers qui s'empilent).

## Pièges qui ne se voient pas dans le code

**Audio et iOS**
- Aucun `await` entre le clic et le premier `osc.start()` : `startPreviewPlayback()`, `startVideoExport()`, `togglePlay()` et `startPlayback()` de la Chanson restent synchrones. Sur iOS, le son passe par un `<audio>` caché pour ignorer le switch silence. Si ça coince, regarder `#synthState` avant de deviner.
- Le sustain du synthé reste borné exprès : un vrai « tenu jusqu'au relâchement » empilerait les voix dans une boucle qui tourne.

**MIDI temps réel**
- `stopPlayback()` reste le filet de sécurité : clear, note-off explicites, CC 64/120/123. Dans `nodes.html`, un note-off n'est envoyé qu'en entrant dans la fenêtre de 150 ms, et on/off alternent strictement par (port, canal, hauteur) : ce qui attend dans la file de Chrome est perdu à la fermeture de l'onglet.
- `#midiPort` est `hidden` mais reste la source de vérité de `refreshPorts()`.

**Atelier**
- `playDir` et `curve` sont des `<input type="hidden">` hors de `liveIds` : `applyPreset()` les assigne et rappelle `renderTransportIcons()`/`toggleCurveEditor()` à la main.
- La courbe `custom` doit rester monotone : une poignée est bornée par ses voisines, sinon les durées de pas deviennent négatives et le scheduler casse.
- `inv()` peut sortir du cadre : le canvas de la page clippe tout seul, pas un rectangle dans un canvas plus grand (`videoCtx.clip()` de l'export vidéo).
- `drawPreview()` doit rester pixel-identique après toute retouche de `paintAnalysisFrame()`/`strokePlayhead()`, partagées avec l'export vidéo.
- `#scanOverlay` est en `pointer-events:none` : à vérifier par capture, pas par un hit-test.
- `loadFile()` et `toggleWebcam()` coupent la lecture d'abord : capturer `wasPlayingMidi` avant, sinon l'auto-play bascule une session MIDI vers les haut-parleurs.

**Nodes et Dessin**
- `p.strokes` est la page sur le chevalet ; `p.pages[p.page]` est périmée tant que `storePage()` n'a pas tourné.
- Une page ne tourne qu'au début d'une boucle : `scheduler()` s'arrête sur l'entier de `schedPos` pour ça.
- `TEMPLATE_KEYS` est déclaré haut dans le fichier : `renderProps()` peut tourner avant `TEMPLATES`.
- `syncLanes()` ne tourne jamais pendant un glissé (`wireHeld`), sinon on détruit le port qui a la capture du pointeur.
- Tout aléatoire passe par `hash01` et tout cycle est entier : un passage sonne toujours pareil et `bakeSpin()` peut le rejouer.
- `applySnapshot()` applique un diff, pas `loadGraph()`, pour qu'un node encore présent garde sa vidéo, sa webcam ou son mesh.
- Karplus-Strong : la boucle de `pluckBuffer()` a une période de N − 0,5 échantillons, pas N + 0,5.
- Grilles Pixel : `cellShift()` et `fillCells()` partagent leurs arrondis ; un décalage arrondi autrement fait déborder un pixel, donc une fausse note.

**CSS et métadonnées**
- Les éléments de formulaire n'héritent pas de `font-family` : garder `button, input, select, textarea{font-family:inherit;}`.
- Les tokens CSS (`:root`) sont dupliqués dans les trois pages, à garder synchronisés. Les couleurs en dur des canvas suivent à la main.
- Balises Open Graph : en dur, en anglais, hors i18n (les crawlers n'exécutent pas le JS), et `og:image` reste une URL absolue.

## Code partagé (`dessons-core.js`)

Seulement du code indépendant de la page (ne lit jamais le DOM ni `layers`/`lastNotes`) : primitives d'analyse d'image (`clamp`, `rgbToHue`, `rgbToHex`, `hexToRgb`, `boxBlurPass`/`boxBlur`, `buildToneLUT`, `adjustPixel`, `sobelAt`, `otsuThreshold`), constantes musicales (`SCALES`, `DIR_DEFS` — les 8 directions affines, `index.html` y ajoute `DIR_DEFS.path` — `INSTR_ICONS`, `GM_INSTR`), maths du trajet dessiné (`PATH_N`, `buildPathModel(points, ar)`, `pathProject`, `pathPointAt` ; `index.html` garde `pathModel()` comme enveloppe avec cache), déplacées depuis `index.html` pour `nodes.html` (vérifié : `.mid` de l'atelier identique à l'octet près sur 5 combinaisons de réglages avant/après, dont une avec trajet dessiné), encodage SMF (`writeVarLen`, `midiTempoTrack(tempo, markers)`, `midiTrack(name, events)`, `midiFile(tracks, ppq)`, `downloadBlob`), courbes (`curveFracAt(mode,k,n,customPts)`, `customCurveAt` — `index.html` garde `curveFrac()`/`customCurveY()` comme enveloppes qui passent `customPoints`), synthé (`unlockAudio`, `createSynthBus` → `{master, out, iosEl}` avec le routage iOS, `timbreFor`, `playSynthVoice` → `{osc,g,sub}`, `fadeOutVoice`, `audioSupported`, `isIOS`), le cadre vidéo 9:16 (`VIDEO_W`, `VIDEO_H`, `VIDEO_FPS`, `drawVideoBackground`, `drawVideoWatermark`), et le stockage des scènes. Chaque page garde son propre `AudioContext` et son suivi de voix. Extraction vérifiée : `buildMidi()` de l'atelier produit un `.mid` identique à l'octet près avant/après. Les tokens CSS (`:root`) sont **dupliqués** dans `compose.html` et `nodes.html` — à garder synchronisés si la palette change.

## Sécurité et tests

- **CSP** : `<meta http-equiv="Content-Security-Policy">` en tête des trois pages, `default-src 'none'` : rien ne peut sortir de la page (ni fetch, ni image distante), `eval` refusé. `'unsafe-inline'` reste nécessaire : tout le code est en ligne. Vérifié en `http` et en `file://`. Toute ressource externe ajoutée un jour devra y être déclarée, à éviter.
- **Fichiers ouverts** : un `.json` vient de n'importe qui. `validateGraph()` contrôle tout **avant** de toucher au graphe affiché (`cleanParams()` remet les curseurs dans leurs bornes, écarte les types inconnus et toute image qui n'est pas `data:image/`), `applyGraph()` fait le chargement et `loadGraph()` restaure l'ancien graphe si ça échoue. Sauvegarde auto impossible (`localStorage` plein) = message `#saveWarn` dans la barre du bas.
- **Capture** : webcam et micro sont coupés quand l'onglet est caché et reprennent seuls au retour (`releaseCapture()`/`resumeCapture()` dans Nodes, `resumeCamera()` dans l'atelier) ; une image figée reste figée. L'accès MIDI n'est demandé que sur un clic, jamais à l'ouverture d'un graphe (`.ccOn`). IndexedDB garde les 8 derniers fichiers 3D (`pruneMeshes()`). L'historique stocke chaque gros fichier une seule fois (`internBlob()`).
- **Tests** : `tests/index.html`, sans dépendance, à ouvrir via un serveur (`python3 -m http.server`, pas en `file://` : l'iframe y serait d'une autre origine). La page teste le vrai `nodes.html?test`, qui sauve sous une autre clé (`dessons.graph.test`) pour ne pas toucher au graphe de l'utilisateur. Les tests sont injectés par balise `<script>`, la CSP refusant `eval`. À lancer avant de publier, à compléter à chaque bug trouvé.

## Licence et docs

- **PolyForm Noncommercial 1.0.0**, choix explicite de l'utilisateur : ne pas repasser en MIT ni en CC sans demande explicite. La musique produite n'est pas couverte, elle appartient à 100 % à l'utilisateur. Dire « source-available », jamais « open source ».
- `README.md` (anglais, principal) et `README.fr.md` restent alignés. `CLAUDE.md` et `docs/notes/` sont en français.
