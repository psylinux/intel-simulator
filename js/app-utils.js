/*-*- mode:javascript;indent-tabs-mode:nil;c-basic-offset:2;tab-width:8;coding:utf-8 -*-│
│ vi: set et ft=javascript ts=2 sts=2 sw=2 fenc=utf-8                               :vi │
╞═══════════════════════════════════════════════════════════════════════════════════════╡
│ Copyright 2026 Marcos Azevedo (aka psylinux)                                          │
│                                                                                       │
│ Permission to use, copy, modify, and/or distribute this software for                  │
│ any purpose with or without fee is hereby granted, provided that the                  │
│ above copyright notice and this permission notice appear in all copies.               │
│                                                                                       │
│ THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL                         │
│ WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED                         │
│ WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE                      │
│ AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL                  │
│ DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR                 │
│ PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER                        │
│ TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR                      │
│ PERFORMANCE OF THIS SOFTWARE.                                                         │
╚───────────────────────────────────────────────────────────────────────────────────────*/

'use strict';

// ─────────────────────────────────────────────────────────
// DOM SHORTCUTS
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ─────────────────────────────────────────────────────────
// ASYNC / TIMING
// ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────
// NUMBER FORMATTING
// ─────────────────────────────────────────────────────────
const hex32 = v => ((v >>> 0).toString(16).padStart(8, '0')).toUpperCase();
const hex64 = (hi, lo) => hex32(hi) + hex32(lo);
const hex8 = v => ((v & 0xFF).toString(16).padStart(2, '0')).toUpperCase();
const fmtA = n => n.toString(16).padStart(4, '0').toUpperCase();
const ease = t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// ─────────────────────────────────────────────────────────
// ARCHITECTURE SHORTCUTS  (depend on S — defined in app-state.js)
// ─────────────────────────────────────────────────────────
const is64 = () => S.arch === 'x64';
const sizeN = () => is64() ? 8 : 4;

function widthName(width) {
  if (width === 1) return 'BYTE';
  if (width === 2) return 'WORD';
  if (width === 8) return 'QWORD';
  return 'DWORD';
}

function widthPtr(width) {
  return `${widthName(width)} PTR`;
}

// ─────────────────────────────────────────────────────────
// I18N SHORTHAND  (delegates to I18N from i18n.js)
// ─────────────────────────────────────────────────────────
function t(key, ...args) {
  if (typeof key !== 'string' || !key) return '';
  return I18N.t(key, ...args);
}

// ─────────────────────────────────────────────────────────
// NUMERIC HELPERS
// ─────────────────────────────────────────────────────────
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getBytes(v32, n) {
  const b = [];
  for (let i = 0; i < n; i++) b.push((v32 >>> (i * 8)) & 0xFF);
  return b; // [LSB, ..., MSB]
}

function ordered(v32, n, end) {
  const b = getBytes(v32, n);
  return end === 'little' ? b : [...b].reverse();
}

function orderedBytes(bytes, end) {
  return end === 'little' ? [...bytes] : [...bytes].reverse();
}

// ─────────────────────────────────────────────────────────
// STACK SIZE HELPERS
// ─────────────────────────────────────────────────────────
function normalizeSpeed(speed) {
  const raw = Number.isFinite(speed) ? speed : 2500;
  return clamp(Math.round(raw), 80, 10000);
}

function normalizeStackSizeBytes(size) {
  const raw = Number.isFinite(size) ? size : DEFAULT_STACK_SIZE;
  return clamp(Math.round(raw), MIN_STACK_SIZE, MAX_STACK_SIZE);
}

function normalizeStackSizeUnit(unit) {
  return unit === 'KB' ? 'KB' : 'B';
}

function preferredStackSizeUnit(size = S.stackSize) {
  const safe = normalizeStackSizeBytes(size);
  return safe >= 1024 && safe % 1024 === 0 ? 'KB' : 'B';
}

function stackSizeUnitFactor(unit = S.stackSizeInputUnit) {
  return normalizeStackSizeUnit(unit) === 'KB' ? 1024 : 1;
}

function trimNumericText(text) {
  return String(text).replace(/\.?0+$/, '');
}

function formatStackSizeInputValue(bytes = S.stackSize, unit = S.stackSizeInputUnit) {
  const safeBytes = normalizeStackSizeBytes(bytes);
  const safeUnit = normalizeStackSizeUnit(unit);
  if (safeUnit === 'KB') {
    const kb = safeBytes / 1024;
    if (Number.isInteger(kb)) return String(kb);
    return trimNumericText(kb.toFixed(kb < 10 ? 3 : 2));
  }
  return String(safeBytes);
}

function formatStackSize(bytes = S.stackSize) {
  const safeBytes = normalizeStackSizeBytes(bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const kb = safeBytes / 1024;
  if (Number.isInteger(kb)) return `${kb} KB`;
  return `${trimNumericText(kb.toFixed(kb < 10 ? 3 : 2))} KB`;
}

function stackHexWidth() {
  return Math.max(4, Math.max(S.stackSize - 1, 0).toString(16).length);
}

function fmtMemA(n) {
  const safe = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  return safe.toString(16).padStart(Math.max(4, stackHexWidth()), '0').toUpperCase();
}

function fmtStackA(n) {
  return fmtMemA(n);
}

// ─────────────────────────────────────────────────────────
// MODULE-LEVEL STATE  (timing / animation / DOM refs)
// ─────────────────────────────────────────────────────────
let asmTraceClickTimer = 0;
let lastStatusLog = '';
const regPulseTimers = new Map();
let centerPaneLayoutFrame = 0;
let memCellRefs = [];
