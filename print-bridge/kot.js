'use strict';
// Builds the ESC/POS bytes for a Kitchen Order Ticket (same layout as the website's KOT).

const ESC = 0x1b;
const GS = 0x1d;

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff);
    else out.push(...p);
  }
  return out;
};

// Thermal printers print plain ASCII reliably; symbols like the rupee sign often don't render.
const ascii = (s) => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(/[^\x20-\x7e\n]/g, '');

const formatWeight = (grams) => {
  const g = Number(grams) || 0;
  if (g <= 0) return '';
  if (g < 1000) return `${g} g`;
  const kg = g / 1000;
  return `${Number.isInteger(kg) ? kg : parseFloat(kg.toFixed(3))} kg`;
};

/**
 * @param {object} job   payload sent by the server (order_number, table_number, items, ...)
 * @param {{cols?:number,cutter?:boolean,timezone?:string}} opts
 */
function buildKot(job, opts = {}) {
  const W = opts.cols || 42;               // 42 = 80mm paper, 32 = 58mm paper
  const cutter = opts.cutter !== false;
  const tz = opts.timezone || 'Asia/Kolkata';
  const center = (s) => bytes(ESC, 0x61, 1, s + '\n');
  const left = (s) => bytes(ESC, 0x61, 0, s + '\n');
  const bold = (on) => bytes(ESC, 0x45, on ? 1 : 0);
  const big = (on) => bytes(GS, 0x21, on ? 0x11 : 0x00);
  const line = '-'.repeat(W);

  const out = [];
  out.push(...bytes(ESC, 0x40));
  out.push(...center(ascii(job.restaurant_name || 'Kitchen').toUpperCase()));
  out.push(...center('KITCHEN ORDER TICKET'));
  out.push(...left(line));

  out.push(...bold(true), ...big(true));
  out.push(...center(ascii(job.order_number)));
  out.push(...big(false), ...bold(false));

  const where = job.table_number
    ? `TABLE ${job.table_number}${job.guest_label ? ' ' + job.guest_label : ''}`
    : ascii(job.order_type === 'PARCEL' ? 'PICK-UP' : job.order_type || '');
  out.push(...center(`${where}  -  ${ascii(job.order_source || '')}`));
  const when = job.created_at ? new Date(job.created_at) : new Date();
  out.push(...center(when.toLocaleString('en-IN', { timeZone: tz })));

  if (job.round && job.round > 1) {
    out.push(...bold(true), ...big(true));
    out.push(...center(`ROUND ${job.round}`));
    out.push(...big(false), ...bold(false));
    out.push(...center('ADD-ON ITEMS ONLY'));
  }
  out.push(...left(line));

  for (const item of job.items || []) {
    out.push(...bold(true));
    const qty = item.weight_grams ? formatWeight(item.weight_grams) : `${item.quantity}x`;
    out.push(...left(`${qty}  ${ascii(item.name)}`));
    out.push(...bold(false));
    if (item.modifiers && item.modifiers.length) out.push(...left(`    ${ascii(item.modifiers.join(', '))}`));
    if (item.special_instructions) out.push(...left(`    * ${ascii(item.special_instructions)}`));
  }

  if (job.special_instructions) {
    out.push(...left(line));
    out.push(...bold(true), ...left('NOTE:'), ...bold(false));
    out.push(...left(ascii(job.special_instructions)));
  }

  out.push(...left(line));
  out.push(...center(new Date().toLocaleTimeString('en-IN', { timeZone: tz })));
  out.push(...bytes(cutter ? '\n\n\n' : '\n\n\n\n\n'));
  if (cutter) out.push(...bytes(GS, 0x56, 1));
  return Buffer.from(out);
}

function buildTestSlip(name, opts = {}) {
  const W = opts.cols || 42;
  const cutter = opts.cutter !== false;
  const out = [];
  out.push(...bytes(ESC, 0x40));
  out.push(...bytes(ESC, 0x61, 1, 'PRINT BRIDGE TEST\n'));
  out.push(...bytes(ESC, 0x61, 0, '-'.repeat(W) + '\n'));
  out.push(...bytes(`Printer: ${ascii(name)}\n`));
  out.push(...bytes('1234567890'.repeat(5).slice(0, W) + '\n'));
  out.push(...bytes('If the number line above is fully\nvisible, the paper width is right.\n'));
  out.push(...bytes('-'.repeat(W) + '\n'));
  out.push(...bytes(cutter ? '\n\n\n' : '\n\n\n\n\n'));
  if (cutter) out.push(...bytes(GS, 0x56, 1));
  return Buffer.from(out);
}

module.exports = { buildKot, buildTestSlip };
