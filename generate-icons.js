/**
 * generate-icons.js
 *
 * Run with Node.js to generate all required extension icon PNGs.
 * Uses the 'canvas' npm package (server-side canvas).
 *
 * Usage: node generate-icons.js
 * Output: assets/icon16.png, icon32.png, icon48.png, icon128.png
 */

const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, "assets");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background circle
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "#1a9e6e");
  grad.addColorStop(1, "#0d2b1f");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Leaf shape
  const cx = size / 2;
  const cy = size / 2;
  const leafSize = size * 0.3;

  ctx.fillStyle = "#25c98a";
  ctx.beginPath();
  ctx.moveTo(cx, cy - leafSize);
  ctx.bezierCurveTo(cx + leafSize, cy - leafSize * 0.5, cx + leafSize, cy + leafSize * 0.5, cx, cy + leafSize * 0.3);
  ctx.bezierCurveTo(cx - leafSize, cy + leafSize * 0.5, cx - leafSize, cy - leafSize * 0.5, cx, cy - leafSize);
  ctx.fill();

  // Stem
  ctx.strokeStyle = "#25c98a";
  ctx.lineWidth = size * 0.06;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy + leafSize * 0.3);
  ctx.lineTo(cx, cy + leafSize * 0.8);
  ctx.stroke();

  return canvas;
}

SIZES.forEach((size) => {
  const canvas = drawIcon(size);
  const outPath = path.join(OUTPUT_DIR, `icon${size}.png`);
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buffer);
  console.log(`Generated: ${outPath}`);
});

console.log("All icons generated.");
