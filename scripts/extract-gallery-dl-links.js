#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const URL_PATTERNS = [
  /https:\/\/www\.redgifs\.com\/[^\s"'<>\\]+/g,
  /https:\/\/preview\.redd\.it\/[^\s"'<>\\]+/g,
];

function collectUrls(value, seen, ordered) {
  if (typeof value === 'string') {
    for (const pattern of URL_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(value)) !== null) {
        const url = match[0].replace(/[),.;]+$/, '');
        if (!seen.has(url)) {
          seen.add(url);
          ordered.push(url);
        }
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, seen, ordered);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectUrls(value[key], seen, ordered);
    }
  }
}

function usage() {
  console.error('Usage: node scripts/extract-gallery-dl-links.js <input.json> [output.txt]');
  console.error('');
  console.error('Extracts https://www.redgifs.com/ and https://preview.redd.it/ links');
  console.error('from a JSON file and writes gallery-dl commands to a text file.');
  process.exit(1);
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || 'gallery-dl-links.txt';

  if (!inputPath) {
    usage();
  }

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  const seen = new Set();
  const ordered = [];
  collectUrls(data, seen, ordered);

  const lines = ordered.map((url) => `gallery-dl ${url}`).join('\n');
  const resolvedOutput = path.resolve(outputPath);
  fs.writeFileSync(resolvedOutput, lines ? `${lines}\n` : '', 'utf8');

  console.error(`Wrote ${ordered.length} link(s) to ${resolvedOutput}`);
}

main();
