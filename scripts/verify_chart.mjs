#!/usr/bin/env node
/**
 * Headless verification for the ServiceNow D3 Sankey renderer.
 *
 * Bundles chart.js (which imports only d3 submodules + the d3-sankey plugin)
 * with real d3 via esbuild, then runs drawChart(container, props, dispatch) in
 * jsdom across a property matrix, asserting an <svg> is produced with no
 * exceptions. Catches the bulk of renderer bugs without an authenticated
 * ServiceNow instance.
 *
 * Usage:
 *   node verify_chart.mjs --chart <path-to-chart.js> [--export <fnName>]
 *
 * Deps (d3@7, d3-sankey, jsdom, esbuild) auto-install into a temp dir on first
 * run. d3-sankey is NOT in the d3 meta-package, so it is installed explicitly.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const chartPath = get('--chart');
const exportName = get('--export') || 'drawChart';
if (!chartPath) { console.error('Usage: node verify_chart.mjs --chart <path-to-chart.js>'); process.exit(2); }

const DEPS = join(tmpdir(), 'snc-d3-verify-sankey');
// d3-sankey is NOT part of the d3 meta-package, so install it explicitly.
if (!existsSync(join(DEPS, 'node_modules', 'esbuild')) || !existsSync(join(DEPS, 'node_modules', 'd3-sankey'))) {
  console.log('Installing verify deps (d3@7, d3-sankey, jsdom, esbuild) into ' + DEPS + ' ...');
  mkdirSync(DEPS, { recursive: true });
  execSync('npm init -y', { cwd: DEPS, stdio: 'ignore' });
  execSync('npm install d3@7 d3-sankey jsdom esbuild', { cwd: DEPS, stdio: 'inherit' });
}
const req = createRequire(pathToFileURL(join(DEPS, 'package.json')));
const esbuild = req('esbuild');
const { JSDOM } = req('jsdom');

const outfile = join(DEPS, 'chart.cjs');
esbuild.buildSync({
  entryPoints: [chartPath], bundle: true, format: 'cjs', platform: 'node',
  outfile, nodePaths: [join(DEPS, 'node_modules')], logLevel: 'warning'
});

const dom = new JSDOM('<!DOCTYPE html><body><div id="c"></div></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
try { if (!global.navigator) global.navigator = dom.window.navigator; } catch (_) { /* read-only: fine */ }
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.performance = global.performance || { now: () => Date.now() };
global.ResizeObserver = class { observe() {} disconnect() {} };
const container = document.getElementById('c');
container.getBoundingClientRect = () => ({ width: 640, height: 420, left: 0, top: 0, right: 640, bottom: 420 });
Object.defineProperty(container, 'clientWidth', { value: 640, configurable: true });

const bundle = req(outfile);
const drawChart = bundle[exportName];
if (typeof drawChart !== 'function') { console.error('Export "' + exportName + '" not found in bundle.'); process.exit(2); }

// ---- sample graphs ----
// Names as source/target (the natural multi-stage flow).
const SAMPLE = {
  nodes: [
    { name: 'Phone', color: '#2E93fA' }, { name: 'Email', color: '#26C6DA' },
    { name: 'Portal', color: '#7E57C2' }, { name: 'Triage', color: '#FF9800' },
    { name: 'In Progress', color: '#FFC107' }, { name: 'Escalated', color: '#EF5350' },
    { name: 'Resolved', color: '#66BB6A' }, { name: 'Closed', color: '#43A047' },
    { name: 'Cancelled', color: '#9E9E9E' }
  ],
  links: [
    { source: 'Phone', target: 'Triage', value: 42 },
    { source: 'Email', target: 'Triage', value: 35 },
    { source: 'Portal', target: 'Triage', value: 58 },
    { source: 'Triage', target: 'In Progress', value: 95 },
    { source: 'Triage', target: 'Cancelled', value: 14 },
    { source: 'Triage', target: 'Escalated', value: 26 },
    { source: 'In Progress', target: 'Resolved', value: 70 },
    { source: 'In Progress', target: 'Escalated', value: 25 },
    { source: 'Escalated', target: 'Resolved', value: 38 },
    { source: 'Escalated', target: 'Cancelled', value: 13 },
    { source: 'Resolved', target: 'Closed', value: 102 }
  ]
};
// Links referencing node INDEXES (numbers) instead of names.
const INDEXED = {
  nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  links: [
    { source: 0, target: 1, value: 10 },
    { source: 0, target: 2, value: 5 },
    { source: 1, target: 3, value: 8 },
    { source: 2, target: 3, value: 4 }
  ]
};
// Mix of names and indices.
const MIXED = {
  nodes: [{ name: 'Start' }, { name: 'Middle' }, { name: 'End' }],
  links: [
    { source: 'Start', target: 1, value: 6 },
    { source: 1, target: 'End', value: 6 }
  ]
};
// Cyclic graph — d3-sankey throws; renderer must CATCH and show empty-state.
const CYCLIC = {
  nodes: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }],
  links: [
    { source: 'X', target: 'Y', value: 5 },
    { source: 'Y', target: 'Z', value: 4 },
    { source: 'Z', target: 'X', value: 3 }
  ]
};
// Link references an unknown node name (auto-created, must not throw).
const UNKNOWN = {
  nodes: [{ name: 'Known' }],
  links: [
    { source: 'Known', target: 'Ghost', value: 7 },
    { source: 'Phantom', target: 'Known', value: 2 }
  ]
};
const SINGLE = { nodes: [{ name: 'A' }, { name: 'B' }], links: [{ source: 'A', target: 'B', value: 9 }] };
const NO_NODES = { nodes: [], links: [] };
const NO_LINKS = { nodes: [{ name: 'Lonely' }], links: [] };
// Self-loop + zero/negative + bad links (all dropped, leaving valid ones).
const DIRTY = {
  nodes: [{ name: 'P' }, { name: 'Q' }, { name: 'R' }],
  links: [
    { source: 'P', target: 'P', value: 5 },
    { source: 'P', target: 'Q', value: 0 },
    { source: 'Q', target: 'R', value: -3 },
    { source: 'P', target: 'R', value: 8 },
    { source: 'Q', target: 'R', value: 4 }
  ]
};
const NO_COLORS = {
  nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  links: [{ source: 'A', target: 'B', value: 3 }, { source: 'B', target: 'C', value: 2 }]
};

// ---- scenario matrix ----
const base = { data: SAMPLE, chartHeight: 420, chartTitle: 'Flow' };
const SCENARIOS = [
  ['defaults', {}],
  ['no title', { chartTitle: '' }],
  ['animate off', { animate: false }],
  ['animate on (explicit)', { animate: true, animationDuration: 400 }],
  ['easing bounceOut', { animationEasing: 'bounceOut' }],
  ['nodeAlign justify', { nodeAlign: 'justify' }],
  ['nodeAlign left', { nodeAlign: 'left' }],
  ['nodeAlign right', { nodeAlign: 'right' }],
  ['nodeAlign center', { nodeAlign: 'center' }],
  ['linkColorMode source', { linkColorMode: 'source' }],
  ['linkColorMode target', { linkColorMode: 'target' }],
  ['linkColorMode gradient', { linkColorMode: 'gradient' }],
  ['linkColorMode static', { linkColorMode: 'static', linkStaticColor: '#888' }],
  ['node labels off', { showNodeLabels: false }],
  ['node labels inside', { showNodeLabels: true, nodeLabelPosition: 'inside' }],
  ['node labels outside', { nodeLabelPosition: 'outside' }],
  ['node values on', { showNodeValues: true, valueFormat: ',.0f' }],
  ['links by name (sample)', { data: SAMPLE }],
  ['links by index', { data: INDEXED }],
  ['links mixed name/index', { data: MIXED }],
  ['cyclic graph (caught)', { data: CYCLIC }],
  ['unknown-node link', { data: UNKNOWN }],
  ['single link', { data: SINGLE }],
  ['empty graph (no nodes)', { data: NO_NODES }],
  ['nodes but no links', { data: NO_LINKS }],
  ['dirty links (self/zero/neg)', { data: DIRTY }],
  ['nodeSort auto', { nodeSort: 'auto' }],
  ['nodeSort none', { nodeSort: 'none' }],
  ['nodeSort ascending', { nodeSort: 'ascending' }],
  ['nodeSort descending', { nodeSort: 'descending' }],
  ['hover highlight off', { hoverHighlight: false, hoverDimOthers: false }],
  ['hover dim others', { hoverDimOthers: true }],
  ['linkHover off', { linkHover: false }],
  ['drop shadow', { dropShadow: true, shadowBlur: 6 }],
  ['node corner radius', { nodeCornerRadius: 6 }],
  ['node stroke', { nodeStroke: '#333', nodeStrokeWidth: 1.5 }],
  ['big node width + padding', { nodeWidth: 28, nodePadding: 20 }],
  ['low curvature', { linkCurvature: 0 }],
  ['high curvature', { linkCurvature: 1 }],
  ['tooltip off', { showTooltip: false }],
  ['custom tooltip template', { tooltipTemplate: '{name}: {value}' }],
  ['color scheme custom', { colorScheme: 'custom', useSeriesColors: false }],
  ['color scheme set3', { colorScheme: 'set3', useSeriesColors: false }],
  ['no node colors (scheme)', { data: NO_COLORS, useSeriesColors: true }],
  ['link opacity extremes', { linkOpacity: 1, linkHoverOpacity: 0.2 }],
  ['null data (fallback empty)', { data: null }],
  ['string-number props', { nodeWidth: '20', nodePadding: '10', linkOpacity: '0.6', chartHeight: '380' }]
];

let pass = 0;
let fail = 0;
for (const [name, override] of SCENARIOS) {
  container.innerHTML = '';
  try {
    drawChart(container, Object.assign({}, base, override), () => {});
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('no <svg> produced');
    pass += 1;
    console.log('  ok    ' + name);
  } catch (e) {
    fail += 1;
    console.log('  FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
  }
}
console.log('');
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
