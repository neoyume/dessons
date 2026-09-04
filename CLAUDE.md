# Dessons — contexte projet

## Ce que c'est

Nom du projet : **Dessons** (contraction de "dessin" et "sons"). Repo GitHub prévu : `neoyume/dessons`.

Outil web mono-fichier (`index.html`, HTML + CSS + JS vanilla, zéro dépendance, zéro build) qui convertit une **image, une vidéo ou un flux webcam** en fichier `.mid` multi-pistes. Usage cible : générer des loops mélodiques/rythmiques à importer dans Logic Pro à partir d'un visuel (photo, illustration, texture, vidéo, caméra).

Deux sorties possibles : export d'un fichier `.mid`, ou lecture temps réel via **Web MIDI** vers un port virtuel (IAC Driver sur macOS) pour entendre/enregistrer la boucle directement dans Logic sans passer par un fichier.

Vidéo et webcam sont ré-analysées ~15 fps (`liveLoop()`) : les notes se recalculent en continu, la boucle MIDI suit l'image qui bouge. Bouton « Figer » pour capturer une frame.

Interface **bilingue FR/EN** (bouton `FR/EN`, détection `navigator.language` au 1er lancement, mémorisée en `localStorage` sous `dessons.lang`).

Tourne 100% dans le navigateur, aucune donnée envoyée à un serveur (l'image, la vidéo et le flux caméra ne quittent pas la machine). Pensé pour être publié tel quel sur GitHub Pages.

## Pourquoi ces choix (pour comprendre le code avant d'y toucher)

- **Pas de framework, pas de bundler** : un seul fichier `index.html`, exprès. Le projet reste "ouvre et ça marche", copiable, forkable sans setup. Toute évolution doit si possible rester dans cette philosophie (ou alors le dire explicitement si on bascule vers un vrai build).
- **Encodage MIDI écrit à la main** (pas de lib type `midi-writer-js`) : format SMF type 1, multi-pistes, delta-times en variable-length quantity. Voir les fonctions `writeVarLen`, `buildMidi`. C'est volontairement bas niveau pour ne dépendre de rien et garder un contrôle total sur la structure du fichier.
- **Détection par contours/contraste, pas par pixel brut** : contrairement à la plupart des convertisseurs image→MIDI existants (qui prennent la couleur moyenne d'un bloc de pixels), celui-ci calcule un gradient de luminosité (différence entre pixels voisins) et ne garde comme "notes" que les zones où ce gradient dépasse un seuil réglable. Ça donne des résultats plus musicaux sur des images à formes nettes (dessins, silhouettes, textures graphiques) que sur des photos très douces/floues.
- **Séparation en calques → pistes/instruments** : par teinte (hue) ou par bande de luminosité, chaque calque devient une piste MIDI distincte avec son propre canal, son patch General MIDI, et son nom. C'est la fonctionnalité différenciante du projet par rapport à l'existant. Boutons **M**/**S** (mute/solo) par calque : `layerAudible(i)` = `anySolo() ? L.solo : !L.mute` (solo prime sur mute, convention DAW). N'affecte QUE la lecture temps réel (scheduler des deux sinks) et l'affichage des points d'aperçu (opacité) ; **`buildMidi()` écrit toujours tous les calques** (le `.mid` est le document complet, le mixage se fait dans le DAW).
- **Grille temps/hauteur plutôt qu'un point par pixel** : l'image est découpée en `steps` divisions (temps) × N voies (hauteur, une par degré de la gamme choisie dans la plage d'octaves choisie). Ça évite d'avoir des centaines de micro-notes injouables, et ça garantit qu'on reste toujours sur la gamme (pas de fausses notes possibles).
- **Sens de lecture réglable** (`playDir` : `lr`/`rl`/`tb`/`bt`) : le temps peut être porté par l'axe horizontal *ou* vertical de l'image, dans un sens ou l'autre. `readDir()` renvoie `{timeOnX, timeRev}`. `process()` produit toujours des notes `{step, midi, vel}` où `step` = ordre de lecture (0 = premier joué) : l'export `.mid` **et** le scheduler temps réel consomment `step` tel quel et n'ont donc pas à connaître la direction — seuls `process()` (échantillonnage des cellules) et `drawPreview()`/`drawPlayhead()` (placement visuel) en tiennent compte. Convention hauteur : quand le temps est horizontal, haut de l'image = aigu ; quand il est vertical, droite = aigu.
- **Courbe de lecture** (`curve` : `linear`/`accel`/`decel`/`pulse`/`swing`) : `stepTimeFrac(k, n)` renvoie la fraction de boucle (0..1) où le pas `k` sonne. Linéaire = `k/n` ; les autres courbent ça (accélérando, ritardando, dense-aux-bords, swing 1 pas sur 2). Consommé par le scheduler (durée de chaque pas = `loopMs * (stepTimeFrac(k+1) - stepTimeFrac(k))`), `drawPlayhead()` (via le ring buffer `stepWin` de `{step, at, span}`), `drawPreview()` (ticks sur le bord d'attaque) **et `buildMidi()`** (positions de tick courbées — la groove est baclée dans le `.mid`, contrairement au mute/solo). `linear` reproduit exactement l'ancien comportement.

## Structure du fichier `index.html`

- CSS en haut : thème "rack audio" sombre, ambre/cyan, inspiré de l'esthétique matériel de studio/synthé modulaire (assumé, pas un défaut générique).
- JS, dans l'ordre :
  1. **i18n** : dictionnaire `I18N = {fr, en}`, helper `t('clé')` pour les chaînes dynamiques, `[data-i18n]` / `[data-i18n-html]` pour le statique. `setLang()` réapplique tout (titre, `<html lang>`, calques auto, libellés instruments, état MIDI) et mémorise. `initialLang()` : `localStorage` puis `navigator.language`. Bouton `#langToggle`.
  2. Constantes : `GM_INSTR` (instruments General MIDI, `{fr, en, prog}`), `SCALES` (intervalles par gamme)
  3. **Source** (`srcEl`, `srcKind` ∈ `image|video|webcam`) : `loadFile()` gère image *et* vidéo, `toggleWebcam()` (`getUserMedia`), `fitCanvas()` dimensionne les canvas, `grabFrame()` copie la frame courante dans `imgCanvas`, `liveLoop()` re-analyse vidéo/webcam en `setTimeout` ~15 fps (sauf si `frozen`). `stopSource()` = filet de nettoyage (stop tracks caméra, pause vidéo, clear timer).
  4. Gestion des calques (`rebuildLayers`, `renderLayerList`) — couleur HSL ; nom auto régénéré selon la langue tant que l'utilisateur n'a pas renommé (`L.auto`)
  5. `readDir()` + `process()` : le cœur — lit `imgCanvas` (peu importe la source), calcule luminosité/contraste/gradient/teinte par pixel, assigne à un calque, échantillonne sur la grille temps×hauteur (orientée selon `playDir`), applique le seuil. Sortie : `lastNotes[calque] = [{step, midi, vel}]`, `step` = ordre de lecture.
  6. `drawPreview()` : dessine la frame courante + points de notes colorés par calque (placement selon `readDir()`)
  7. `buildMidi()` / `writeVarLen()` / helpers binaires : génère le fichier `.mid` en `Uint8Array`
  8. Transport & sorties : un seul moteur (scheduler + tête de lecture), deux **sinks** via la variable `sink` :
     - `sink === 'midi'` — Web MIDI temps réel : `ensureMidi()` (lazy `requestMIDIAccess`, au 1er clic), `refreshPorts()` (auto-sélectionne un port `/IAC|bus/i`), `setMidiState(clé, on, arg)` / `renderMidiState()` (statut re-traduisible, `{x}` = port), `midiOut.send(bytes, timestamp)` en horloge `performance.now()`. `stopPlayback` : `midiOut.clear()` + note-off explicites (`hangingNotes`) + CC 120/123 (`usedChannels`).
     - `sink === 'synth'` — **synthé d'aperçu Web Audio** (zéro dépendance) : bouton « Écouter l'aperçu » (panneau de gauche). `ensureAudio()` (crée l'`AudioContext` au 1er clic + compresseur + petite réverb `makeImpulse`), `timbreFor(prog)` (famille GM → forme d'onde + ADSR + filtre), `spawnVoice()` (osc + biquad + enveloppe, `+sub` pour les basses, plafond 96 voix), `stopAllVoices()`. L'horloge audio est verrouillée sur `performance.now` à chaque tick du scheduler (`audioEpoch`).
     Commun : `stepDurationMs()`, `scheduler()` (**planification juste-à-temps** : `setInterval` 25 ms, lookahead 150 ms, relit `lastNotes`/tempo/gate à chaque pas → édition live ; resync si gros retard ; branche sur `sink`), `startPlayback(which)` / `stopPlayback()`, `updateTransportButtons()`, `drawPlayhead()` (rAF, position `playStep`/`nextStepTime`, axe+sens selon `readDir()`). Les deux boutons sont exclusifs (lancer l'un stoppe l'autre). `visibilitychange` coupe le transport et met `liveLoop` en pause.
  9. Listeners : tout est recalculé en live (`process()`) à chaque changement de slider, avec un flag `structureIds` pour savoir quand reconstruire les calques vs juste retraiter. `liveIds` inclut `playDir` ; `structureIds` non (le sens de lecture ne touche pas les calques). Fin du script : `syncLabels()` → `updatePlayBtnState()` → `setLang(initialLang())`.

## État actuel

Fonctionnel, testé par l'utilisateur, exporte bien vers Logic Pro. Publié : https://github.com/neoyume/dessons

Licence **CC BY-NC 4.0** (choix explicite de l'utilisateur) : usage/modif/partage non commercial avec attribution, interdit de vendre ou redistribuer l'outil comme produit/service payant. En revanche la **musique produite avec Dessons n'est pas couverte** — l'utilisateur peut la vendre. Le fichier `LICENSE` a un en-tête qui clarifie ce point, suivi du texte légal CC complet. Ne pas repasser en MIT sans demande explicite.

Docs bilingues : `README.md` (anglais, fichier principal vu par défaut sur GitHub) + `README.fr.md` (français), liés en tête l'un de l'autre. `CLAUDE.md` reste en français.

Ajouts successifs (tous rétro-compatibles avec l'export `.mid` de base) :
- **Web MIDI temps réel** (bouton « Jouer dans Logic ») : boucle en direct vers un port virtuel, un canal par calque, planification juste-à-temps (les réglages s'entendent immédiatement). Chrome/Edge uniquement.
- **Sens de lecture** (gauche→droite, droite→gauche, haut→bas, bas→haut) : aperçu + temps réel + export.
- **Vidéo & webcam** en source, ré-analysées en live (~15 fps) → la boucle MIDI suit l'image. Bouton « Figer ».
- **Synthé d'aperçu Web Audio** (bouton « Écouter l'aperçu ») : joue la boucle dans le navigateur sans DAW, sons de synthé approximatifs mappés sur les familles GM. Zéro dépendance. Marche aussi sur Safari (contrairement au Web MIDI).
- **Mute / Solo par calque** (boutons M/S) : filtre la lecture temps réel (aperçu + Web MIDI), pas l'export.
- **Courbe de lecture** (`curve`, 5 presets) : time-warp de la tête de lecture (accéléré / ralenti / pulsé / swing). Affecte l'aperçu, le Web MIDI **et** l'export.
- **Interface bilingue FR/EN** avec détection auto + mémorisation.
- **Don / Ko-fi** : `ko-fi.com/neoyume`. Lien dans le `<footer>` de l'appli (i18n : `footerFree` / `footerKofi`), badge + section « Soutenir » dans les README, `.github/FUNDING.yml` pour le bouton Sponsor GitHub. Pas de fonctionnalité payante — le don est purement optionnel, ne jamais gater quoi que ce soit derrière.

## Pistes d'itération possibles (non demandées explicitement, à proposer si pertinent)

- Mode "grille régulière" en alternative au mode contours, pour forcer des motifs rythmiques plus prévisibles/carrés plutôt que suivre la forme de l'image
- ~~Prévisualisation audio dans le navigateur~~ → **fait** (synthé Web Audio, bouton « Écouter l'aperçu »). Amélioration possible : vrais échantillons GM (soundfont) si les sons de synthé actuels sont jugés trop pauvres — mais ça coûte le zéro-dépendance ou des Mo de samples à fetch
- Undo/presets : sauvegarder des réglages (gamme/contraste/seuil) en `localStorage` — déjà utilisé pour la langue (`dessons.lang`), le même mécanisme peut servir aux presets
- Détection de contours plus fine (vrai Sobel avec diagonales, ou Canny) si le gradient simple actuel s'avère insuffisant sur certains types d'images
- Export vers d'autres formats (Ableton .als, simple CSV de notes, ou JSON réutilisable)
- Mode batch : traiter un dossier d'images d'un coup pour générer plusieurs loops
- Choix de la caméra (`enumerateDevices`) et résolution webcam ; enregistrement de la sortie vidéo webcam avec la boucle

## Ce qu'il faut éviter de casser

- Le zéro-dépendance / zéro-build : ne pas introduire npm/webpack sans que ce soit une décision explicite et assumée avec l'utilisateur
- Le fait que ça reste utilisable en `file://` direct (double-clic) en plus de GitHub Pages
- La logique de gamme (aucune note hors gamme ne doit pouvoir sortir) — c'est un principe central du projet, pas un détail
- Le fait que l'export `.mid` marche sans Web MIDI : le mode temps réel est un bonus, jamais un prérequis. Si `navigator.requestMIDIAccess` est absent, le reste doit fonctionner normalement (seul le bouton « Jouer dans Logic » est désactivé). Idem webcam : si `getUserMedia` manque, image + vidéo doivent marcher.
- Pas de notes bloquées : tout ajout au scheduler temps réel doit garantir un note-off correspondant, et `stopPlayback()` doit rester le filet de sécurité (clear + note-off explicites + CC 123).
- La parité FR/EN : toute nouvelle chaîne visible passe par `I18N` (les deux langues) ou `[data-i18n]`, jamais en dur. `t()` pour le JS. Vérifier que `Object.keys(I18N.fr)` == `Object.keys(I18N.en)`.
- Le nettoyage des sources : toujours passer par `stopSource()` avant d'en démarrer une autre (sinon caméra qui reste allumée, timers qui s'empilent).
