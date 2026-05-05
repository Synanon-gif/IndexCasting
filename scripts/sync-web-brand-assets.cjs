'use strict';
/**
 * After `expo export --platform web`, copy the canonical app icon to dist for
 * Safari / “Add to Home Screen” — same graphic as native app icon (no in-app Image logo).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const indexPath = path.join(distDir, 'index.html');
const iconSrc = path.join(root, 'assets', 'icon.png');
const appleDest = path.join(distDir, 'apple-touch-icon.png');

if (!fs.existsSync(distDir) || !fs.existsSync(indexPath)) {
  console.warn('[sync-web-brand-assets] dist/ or index.html missing — skip.');
  process.exit(0);
}

if (!fs.existsSync(iconSrc)) {
  console.warn('[sync-web-brand-assets] assets/icon.png missing — skip.');
  process.exit(0);
}

fs.copyFileSync(iconSrc, appleDest);

let html = fs.readFileSync(indexPath, 'utf8');
const linkTag = '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

if (!html.includes('apple-touch-icon')) {
  html = html.replace(/<\/head>/i, `\n    ${linkTag}\n  </head>`);
  fs.writeFileSync(indexPath, html);
}
