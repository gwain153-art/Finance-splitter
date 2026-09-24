# Crimson Cut

An over-the-top paycheck splitter built to live on your iPhone home screen.

Put in what landed, carve it into buckets (percent of pay or fixed amounts), then swipe the blade to cut the banknote into pieces that fly into each bucket.

- Live WebGL crimson smoke background that reacts to touch, tilt and splits
- Banknote cutscene: katana slashes, flying strips, confetti, screen shake
- Synthesised sound design that plays through the iPhone silent switch
- Real iPhone haptics (iOS 18+ switch trick, vibrate on Android)
- Custom keypad, rolling odometer numbers, liquid-fill buckets, goals per bucket
- Transfer Run: after a cut, stamp a slip per bucket as you move the money in your bank app (copy-amount buttons, swipe-to-stamp, auto buckets pre-stamped); splits stay pending until banked
- The Vault: a safe door that cracks open, all-time totals, stacked chart, history with undo
- Ranks: 16 levels, XP (bonus for banking fast), 38 achievements (some hidden); Settings > Reset rank
- Installable PWA: works offline, launch screens, home-screen icon
- Backup export/import (data lives on your device)

No build step. Serve the folder over HTTPS (GitHub Pages or Netlify) and open it in Safari, then Share > Add to Home Screen.

Local: `python3 -m http.server` and open http://localhost:8000.

`dev/` holds test pages for sound, background, FX and PWA, plus the v1 single-file version.
