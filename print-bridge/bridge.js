#!/usr/bin/env node
'use strict';
/**
 * AuraOS print bridge.
 *
 * Runs on a PC at the restaurant. Every couple of seconds it asks your AuraOS server for
 * new print jobs (kitchen tickets, receipts) and sends them to the printers listed in
 * config.json — either a network printer (IP + port 9100) or a Windows printer by name (USB).
 *
 *   node bridge.js                 run the bridge
 *   node bridge.js --list          list the Windows printers
 *   node bridge.js --test KOT      print a test slip on the KOT printer (or BILL)
 *
 * Needs Node.js 18 or newer. No other packages.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { buildKot, buildTestSlip } = require('./kot');

const CONFIG_PATH = process.env.BRIDGE_CONFIG || path.join(__dirname, 'config.json');
const log = (...a) => console.log(new Date().toLocaleTimeString('en-IN'), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    console.error(`Cannot read ${CONFIG_PATH}. Copy config.example.json to config.json and fill it in.`);
    process.exit(1);
  }
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { console.error('config.json is not valid JSON:', e.message); process.exit(1); }
  if (!cfg.server_url || !cfg.bridge_key) { console.error('config.json needs "server_url" and "bridge_key".'); process.exit(1); }
  cfg.server_url = String(cfg.server_url).replace(/\/+$/, '');
  cfg.poll_ms = Math.max(1000, Number(cfg.poll_ms) || 2000);
  cfg.printers = cfg.printers || {};
  return cfg;
}

// ── Sending bytes to a printer ───────────────────────────────────────────────
function sendNetwork(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 6000 });
    let done = false;
    const finish = (err) => { if (done) return; done = true; socket.destroy(); err ? reject(err) : resolve(); };
    socket.on('connect', () => socket.end(data, () => setTimeout(() => finish(), 300)));
    socket.on('timeout', () => finish(new Error(`Timed out connecting to ${host}:${port}`)));
    socket.on('error', (e) => finish(new Error(`Cannot reach ${host}:${port} - ${e.message}`)));
  });
}

function sendWindows(printerName, data) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('"windows" printers only work when the bridge runs on Windows'));
    const file = path.join(os.tmpdir(), `auraos-job-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(file, data);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'rawprint.ps1'), '-PrinterName', printerName, '-FilePath', file],
      { timeout: 20000, windowsHide: true },
      (err, _out, stderr) => {
        fs.unlink(file, () => {});
        if (err) reject(new Error((stderr || err.message || '').trim() || 'Windows print failed'));
        else resolve();
      },
    );
  });
}

function sendToPrinter(cfg, target, data) {
  const p = cfg.printers[target];
  if (!p) throw new Error(`No "${target}" printer set in config.json`);
  if (p.type === 'network') return sendNetwork(p.host, Number(p.port) || 9100, data);
  if (p.type === 'windows') return sendWindows(p.name, data);
  throw new Error(`Printer "${target}" has unknown type "${p.type}" (use "network" or "windows")`);
}

// ── Talking to the server ────────────────────────────────────────────────────
async function api(cfg, route, body) {
  const res = await fetch(`${cfg.server_url}/api/v1/print-bridge${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-key': cfg.bridge_key },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return json?.data;
}

function jobBytes(cfg, job) {
  const p = cfg.printers[job.target] || {};
  if (job.kind === 'RAW') return Buffer.from(String(job.payload.data || ''), 'base64');
  return buildKot(job.payload, { cols: p.cols, cutter: p.cutter, timezone: cfg.timezone });
}

async function handleJob(cfg, job) {
  const label = job.kind === 'KOT' ? `KOT ${job.payload.order_number}${job.payload.round > 1 ? ` (round ${job.payload.round})` : ''}` : `${job.target} receipt`;
  try {
    await sendToPrinter(cfg, job.target, jobBytes(cfg, job));
    await api(cfg, `/jobs/${job.id}/result`, { ok: true });
    log(`Printed ${label} -> ${job.target} printer`);
  } catch (err) {
    log(`FAILED ${label}: ${err.message}`);
    await api(cfg, `/jobs/${job.id}/result`, { ok: false, error: err.message }).catch(() => {});
  }
}

async function run() {
  const cfg = loadConfig();
  log(`AuraOS print bridge started. Server: ${cfg.server_url}`);
  for (const [t, p] of Object.entries(cfg.printers)) {
    log(`  ${t} printer: ${p.type === 'network' ? `${p.host}:${p.port || 9100}` : `Windows printer "${p.name}"`}`);
  }
  let wasOffline = false;
  for (;;) {
    try {
      const data = await api(cfg, '/bridge/claim');
      if (wasOffline) { log('Connected to the server again'); wasOffline = false; }
      for (const job of (data && data.jobs) || []) await handleJob(cfg, job);
      await sleep(cfg.poll_ms);
    } catch (err) {
      if (err.status === 401) log(`Server refused the bridge key: ${err.message}. Check "bridge_key" in config.json and that the bridge is turned on in the website.`);
      else if (!wasOffline) log(`Cannot reach the server (${err.message}). Will keep retrying...`);
      wasOffline = true;
      await sleep(err.status === 401 ? 10000 : 5000);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    if (process.platform !== 'win32') { console.log('Run this on the Windows PC.'); return; }
    execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], (e, out) => {
      console.log(e ? e.message : 'Windows printers (use the name exactly):\n' + out.trim());
    });
    return;
  }
  if (args[0] === '--test') {
    const cfg = loadConfig();
    const target = (args[1] || 'KOT').toUpperCase();
    const p = cfg.printers[target];
    try {
      await sendToPrinter(cfg, target, buildTestSlip(target, { cols: p && p.cols, cutter: p && p.cutter }));
      console.log(`Test slip sent to the ${target} printer.`);
    } catch (e) { console.error(`Test failed: ${e.message}`); process.exitCode = 1; }
    return;
  }
  await run();
}

main();
