#!/usr/bin/env node
/*
 * Builds dist/echo-show-dashboard.js: every card in src/ concatenated into one file,
 * so Home Assistant only needs a single dashboard resource.
 *
 *   node build.js          build
 *   node build.js --check  fail if dist/ is out of date with src/ (used by CI)
 *
 * No dependencies. Each source file is a self-contained IIFE that guards its own
 * customElements.define(), so the bundle is safe to load next to old copies.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = __dirname;
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// Load order matters only for readability; the cards don't depend on each other at load time.
var FILES = [
  "echo-weather-card.js",
  "echo-timer-card.js",
  "echo-media-card.js",
  "echo-notify.js",
];

function versionOf(src) {
  var m = /var VERSION = "([^"]+)"/.exec(src);
  return m ? m[1] : "?";
}

var parts = [], versions = [];
FILES.forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, "src", f), "utf8");
  new vm.Script(src, { filename: f });              // syntax check
  versions.push(f.replace(/\.js$/, "") + " " + versionOf(src));
  parts.push("\n/* ===== " + f + " ===== */\n" + src.replace(/\s+$/, "") + "\n");
});

var banner =
  "/*!\n" +
  " * Echo Show Dashboard " + pkg.version + "\n" +
  " * " + pkg.homepage + "\n" +
  " * " + versions.join(", ") + "\n" +
  " * License: " + pkg.license + "\n" +
  " * Built from src/ by build.js. Edit the files in src/, not this one.\n" +
  " */\n";

var footer =
  "\n;(function () {\n" +
  "  window.EchoShowDashboard = { version: " + JSON.stringify(pkg.version) + ", cards: " + JSON.stringify(versions) + " };\n" +
  "  console.info(\"%c Echo Show Dashboard " + pkg.version + " \", \"background:#ff8a00;color:#000;border-radius:3px\");\n" +
  "})();\n";

var out = banner + parts.join("") + footer;
new vm.Script(out, { filename: "echo-show-dashboard.js" });

var dest = path.join(ROOT, "dist", "echo-show-dashboard.js");
if (process.argv.indexOf("--check") !== -1) {
  var cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
  if (cur !== out) {
    console.error("dist/echo-show-dashboard.js is out of date. Run: node build.js");
    process.exit(1);
  }
  console.log("dist/ is up to date (" + out.length + " bytes)");
} else {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  console.log("wrote dist/echo-show-dashboard.js (" + out.length + " bytes): " + versions.join(", "));
}
