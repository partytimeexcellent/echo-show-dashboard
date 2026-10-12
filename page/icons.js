#!/usr/bin/env node
/*
 * Writes page/icons.json: the SVG paths of every mdi: icon named in src/ and the example
 * dashboard, for the custom page (which has no Home Assistant frontend to draw ha-icon).
 * Other icons load on demand from Home Assistant's own icon files.
 *
 *   npm pack @mdi/js && tar xzf mdi-js-*.tgz      (anywhere)
 *   node page/icons.js <path to package/mdi.js>
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var src = process.argv[2];
if (!src) { console.error("usage: node page/icons.js <@mdi/js mdi.js>"); process.exit(1); }

var paths = {};
var re = /export (?:var|const) (mdi\w+) = "([^"]+)"/g, m;
var text = fs.readFileSync(src, "utf8");
while ((m = re.exec(text))) paths[m[1]] = m[2];

function camel(name) { return "mdi" + name.split("-").map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(""); }

var files = fs.readdirSync(path.join(ROOT, "src")).map(function (f) { return path.join(ROOT, "src", f); })
  .concat(fs.readdirSync(path.join(ROOT, "homeassistant", "dashboards")).map(function (f) { return path.join(ROOT, "homeassistant", "dashboards", f); }));
var names = {};
files.forEach(function (f) {
  var t = fs.readFileSync(f, "utf8"), r = /mdi:([a-z0-9-]+)/g, x;
  while ((x = r.exec(t))) names[x[1]] = true;
});

var out = {}, missing = [];
Object.keys(names).sort().forEach(function (n) {
  var p = paths[camel(n)];
  if (p) out[n] = p; else missing.push(n);
});
fs.writeFileSync(path.join(__dirname, "icons.json"), JSON.stringify(out) + "\n");
console.log("wrote page/icons.json: " + Object.keys(out).length + " icons" + (missing.length ? "; not in @mdi/js: " + missing.join(", ") : ""));
