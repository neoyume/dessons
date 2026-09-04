**English** · [Français](README.fr.md)

# Dessons

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-13C3FF?logo=kofi&logoColor=white)](https://ko-fi.com/neoyume)

*dessin + sons* (French for "drawing + sounds") — turns an image, a video or a webcam feed into a multi-track MIDI file, exported as `.mid` or streamed live into your DAW through a virtual MIDI port. Built for making loops in Logic Pro (or any DAW).

By [neoyume](https://github.com/neoyume). Contributions welcome.

Runs entirely in the browser — no server, no dependencies, nothing sent anywhere. Your image, video and webcam feed stay on your machine.

The interface is bilingual **French / English**: `FR / EN` switch in the top-right corner, language auto-detected on first launch, then remembered.

## Run it locally

No installation needed. Two options:

- Double-click `index.html` to open it straight in your browser.
- Or start a small local server (useful if your browser blocks some features over `file://` — Web MIDI or the webcam, depending on your setup):
  ```bash
  python3 -m http.server 8000
  ```
  then open `http://localhost:8000`.

## Run it online (GitHub Pages)

1. Create a public GitHub repo and push this folder into it (commands below).
2. In the repo: **Settings → Pages → Source**, pick the `main` branch and the `/ (root)` folder.
3. GitHub gives you a URL like `https://<your-user>.github.io/<repo-name>/` — reachable from any device, mobile included.

## How it works

- **Source**: drop an **image** (JPG / PNG / WebP) or a **video** (MP4 / WebM / MOV), or turn on the **webcam**. Video and webcam are re-analysed ~15 times per second: the notes are recomputed live and, together with "Play into Logic", the MIDI loop evolves with the moving image. The **Freeze** button captures a single frame.
- **Contrast / Sensitivity**: control which parts of the image become notes. Lower sensitivity means fewer notes (only the most contrasted areas are kept).
- **Split into layers**: separate the image by color (hue) or by brightness (shadows / midtones / highlights). Each layer becomes its own MIDI track, with its own General MIDI instrument and name.
- **Scale / octave / tempo / bars**: one image axis is quantized to the chosen scale (no wrong notes possible), the other becomes time.
- **Playback direction**: left→right (default), right→left, top→bottom or bottom→top. Sets which axis carries time and which way the playhead sweeps it — applies to the preview, real-time playback and the export.
- **Export**: generates a `.mid` file (format 1, multi-track) ready to import into Logic Pro — one track per layer is created automatically on import.
- **Play into Logic (real-time)**: instead of exporting, stream the loop live via [Web MIDI](https://developer.mozilla.org/docs/Web/API/Web_MIDI_API) to a virtual MIDI port. On macOS: open *Audio MIDI Setup* → *Window* → *Show MIDI Studio* → double-click *IAC Driver* → tick *Device is online*. Pick that port in Dessons, arm an instrument track in Logic, click **Play into Logic**: the loop runs and you can record it. Every setting (contrast, scale, tempo, instruments, playback direction, webcam frame…) is heard immediately while playing, without stopping. Requires Chrome or Edge — Safari has no Web MIDI; use the `.mid` export in that case.

## One track per layer in Logic

Dessons sends each layer on its own MIDI channel (layer 1 → channel 1, layer 2 → channel 2…). Two ways to get one Logic track per layer:

**A — Auto demix (records straight to separate tracks, in one live pass)**

1. `File > Project Settings > Recording` → tick **"Auto demix by channel if multitrack recording"**. If *Project Settings* isn't in the File menu, use the **Settings** button (sliders icon) in the control bar → *Project Settings → Recording*.
2. Create your instrument tracks **in layer order** (layer 1 → track 1, etc.), pick a sound on each.
3. Select them all and **record-enable all of them** (red **R** on each — ⌥-click to arm several).
4. Record, and play from Dessons. Logic routes channel 1 → the first armed track, channel 2 → the second, and so on.

**B — Record to one track, then split (bulletproof)**

1. Record the whole Dessons output onto a **single** instrument track (all layers land in one region, on channels 1–N).
2. Right-click the region → **Separate MIDI Events → By Event Channel**. Logic makes one track per channel; assign an instrument to each.

Method A is the true real-time multitrack path but is known to be finicky (arming order, tracks left on "All" channel). Method B is one record pass + one click — the only downside is you hear everything through one sound while recording.

## Project structure

```
dessons/
├── index.html              # the whole app (HTML + CSS + JS, single file)
├── README.md               # English docs (this file)
├── README.fr.md            # French docs
├── LICENSE                 # CC BY-NC 4.0
├── CLAUDE.md               # project context for iterating with Claude Code
└── .github/FUNDING.yml     # Ko-fi link for the repo's Sponsor button
```

## Publish to GitHub (first time)

From this folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/neoyume/dessons.git
git push -u origin main
```

The repo must already exist on GitHub under that name (create it from the web UI, without a README or .gitignore to avoid a conflict on the first sync).

## Support

Dessons is free, with no paywalled features — ever. If it's useful to you, you can leave a tip on Ko-fi: **[ko-fi.com/neoyume](https://ko-fi.com/neoyume)** ☕. No pressure.

## Contributing

Issues and pull requests are welcome — bugs, new layer-separation methods, other export formats, and so on. By submitting a contribution you agree to license it under CC BY-NC 4.0, like the rest of the project.

## License

[CC BY-NC 4.0](LICENSE) © [neoyume](https://github.com/neoyume).

Free to use, modify and share **for non-commercial purposes**, with attribution.
You may **not** sell Dessons or redistribute it (modified or not) as a paid
product or service.

**Music you make with Dessons is yours** — the license covers the tool, not its
output. Use your loops for anything, commercial releases included.
