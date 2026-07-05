/**
 * D3 Sankey-diagram renderer.
 *
 * `drawChart` fully (re)renders the diagram into `container` on every call. It
 * owns the SVG subtree imperatively while the Seismic/snabbdom view only
 * provides the stable host container. Re-rendering on each property change keeps
 * the look-and-feel fully driven by the UI Builder property panel.
 *
 * We import the specific d3 functions we use as NAMED imports (rather than
 * `import * as d3`): the ServiceNow production build tree-shakes a namespace
 * object that's passed around, which would strip methods like `select`. Core d3
 * comes from its submodules; the d3-sankey plugin is a SEPARATE package and is
 * imported with named imports (tree-shake-safe).
 *
 * No `d3-transition` (it gets tree-shaken out of the prod bundle) — the grow-in
 * animation is driven by requestAnimationFrame.
 *
 * dispatch(actionName, payload) emits the custom actions declared in now-ui.json
 * (CHART_CLICKED / NODE_CLICKED / LINK_CLICKED / NODE_HOVERED) so page authors
 * can hook them as event handlers in UI Builder.
 */
import { select } from 'd3-selection';
import { scaleOrdinal } from 'd3-scale';
import {
	schemeCategory10, schemeTableau10, schemeSet2, schemeSet3,
	schemePaired, schemeDark2, schemePastel1, schemeAccent
} from 'd3-scale-chromatic';
import { format } from 'd3-format';
import { color } from 'd3-color';
import {
	easeLinear, easeCubicOut, easeCubicInOut, easeQuadOut,
	easeExpOut, easeBackOut, easeBounceOut, easeElasticOut
} from 'd3-ease';
import {
	sankey, sankeyLinkHorizontal,
	sankeyLeft, sankeyRight, sankeyCenter, sankeyJustify
} from 'd3-sankey';

// Named categorical schemes selectable via the `colorScheme` property.
const COLOR_SCHEMES = {
	category10: schemeCategory10,
	tableau10: schemeTableau10,
	set2: schemeSet2,
	set3: schemeSet3,
	paired: schemePaired,
	dark2: schemeDark2,
	pastel1: schemePastel1,
	accent: schemeAccent
};

// Easing curves selectable via the `animationEasing` property.
const EASINGS = {
	linear: easeLinear,
	cubicOut: easeCubicOut,
	cubicInOut: easeCubicInOut,
	quadOut: easeQuadOut,
	expOut: easeExpOut,
	backOut: easeBackOut,
	bounceOut: easeBounceOut,
	elasticOut: easeElasticOut
};

// d3-sankey node alignment functions selectable via the `nodeAlign` property.
const ALIGNMENTS = {
	justify: sankeyJustify,
	left: sankeyLeft,
	right: sankeyRight,
	center: sankeyCenter
};

const num = (v, fallback) => {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : fallback;
};

const isBlank = (v) => v === undefined || v === null || v === '';

/**
 * Normalize the bound `data` into a clean { nodes, links } graph d3-sankey can
 * consume. Resolves string source/target (node NAME) and numeric source/target
 * (node INDEX) into node names, auto-creates referenced-but-missing nodes, drops
 * self-loops and zero/negative links, and de-dupes node names.
 */
const normalizeGraph = (raw) => {
	const g = (raw && typeof raw === 'object') ? raw : {};
	const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
	const rawLinks = Array.isArray(g.links) ? g.links : [];

	// Build the ordered node list (de-duped by name) keeping per-node metadata.
	const nodes = [];
	const nameToNode = {};
	const addNode = (name, extra) => {
		const nm = (name === undefined || name === null || name === '') ? null : String(name);
		if (nm === null) return null;
		if (nameToNode[nm]) {
			if (extra && extra.color && !nameToNode[nm].color) nameToNode[nm].color = extra.color;
			return nameToNode[nm];
		}
		const node = { name: nm };
		if (extra && extra.color) node.color = extra.color;
		nameToNode[nm] = node;
		nodes.push(node);
		return node;
	};

	rawNodes.forEach((n, i) => {
		if (n && typeof n === 'object') addNode(isBlank(n.name) ? `Node ${i + 1}` : n.name, { color: n.color });
		else addNode(n);
	});

	// Resolve a source/target reference: number = index into the original node
	// list; string = node name (auto-created if unknown).
	const resolveName = (ref) => {
		if (typeof ref === 'number' && Number.isFinite(ref)) {
			const orig = rawNodes[ref];
			if (orig && typeof orig === 'object') return isBlank(orig.name) ? `Node ${ref + 1}` : String(orig.name);
			if (orig !== undefined && orig !== null) return String(orig);
			// index out of range -> synthesize a stable name and ensure the node exists
			const synth = `Node ${ref + 1}`;
			addNode(synth);
			return synth;
		}
		if (isBlank(ref)) return null;
		const nm = String(ref);
		if (!nameToNode[nm]) addNode(nm); // referenced-but-missing -> auto-create
		return nm;
	};

	const links = [];
	rawLinks.forEach((l) => {
		if (!l || typeof l !== 'object') return;
		const sName = resolveName(l.source);
		const tName = resolveName(l.target);
		if (sName === null || tName === null) return;
		if (sName === tName) return; // skip self-loops (d3-sankey can't lay them out)
		const value = num(l.value, NaN);
		if (!Number.isFinite(value) || value <= 0) return;
		links.push({ source: sName, target: tName, value: value });
	});

	return { nodes, links };
};

export function drawChart(container, props, dispatch) {
	// ----- normalize props (values may arrive as strings from the panel) -----
	const backgroundColor = props.backgroundColor || 'transparent';
	const fontFamily = props.fontFamily || 'inherit';
	const chartTitle = props.chartTitle || '';
	const titleColor = props.titleColor || '#374151';
	const titleFontSize = num(props.titleFontSize, 18);

	const nodeAlign = ALIGNMENTS[props.nodeAlign] || sankeyJustify;
	const nodeWidth = Math.max(2, num(props.nodeWidth, 16));
	const nodePadding = Math.max(0, num(props.nodePadding, 12));
	const nodeCornerRadius = Math.max(0, num(props.nodeCornerRadius, 2));
	const nodeStroke = props.nodeStroke || '';
	const nodeStrokeWidth = Math.max(0, num(props.nodeStrokeWidth, 0));
	const nodeSort = ['auto', 'none', 'ascending', 'descending'].includes(props.nodeSort) ? props.nodeSort : 'auto';

	const linkColorMode = ['source', 'target', 'gradient', 'static'].includes(props.linkColorMode) ? props.linkColorMode : 'gradient';
	const linkStaticColor = props.linkStaticColor || '#94a3b8';
	const linkOpacity = Math.max(0, Math.min(1, num(props.linkOpacity, 0.45)));
	const linkHoverOpacity = Math.max(0, Math.min(1, num(props.linkHoverOpacity, 0.75)));
	const linkCurvature = Math.max(0, Math.min(1, num(props.linkCurvature, 0.5)));
	const linkHover = props.linkHover !== false;
	const hoverHighlight = props.hoverHighlight !== false;
	const hoverDimOthers = props.hoverDimOthers !== false;
	const hoverColor = props.hoverColor || '';

	const useSeriesColors = props.useSeriesColors !== false;
	const colorScheme = props.colorScheme || 'tableau10';
	const palette = Array.isArray(props.colorPalette) && props.colorPalette.length
		? props.colorPalette
		: ['#2E93fA', '#66DA26', '#546E7A', '#E91E63', '#FF9800', '#9C27B0'];
	const schemeColors = (colorScheme !== 'custom' && COLOR_SCHEMES[colorScheme]) ? COLOR_SCHEMES[colorScheme] : palette;

	const showNodeLabels = props.showNodeLabels !== false;
	const nodeLabelPosition = ['auto', 'outside', 'inside'].includes(props.nodeLabelPosition) ? props.nodeLabelPosition : 'auto';
	const nodeLabelFontSize = num(props.nodeLabelFontSize, 12);
	const nodeLabelColor = props.nodeLabelColor || '#374151';
	const showNodeValues = props.showNodeValues === true;
	const nodeValueFontSize = Math.max(4, num(props.nodeValueFontSize, 9));
	const nodeValueColor = props.nodeValueColor || '#ffffff';

	const dropShadow = props.dropShadow === true;
	const shadowBlur = Math.max(0, num(props.shadowBlur, 4));

	const animationDuration = Math.max(0, num(props.animationDuration, 800));
	const animationStagger = Math.max(0, num(props.animationStagger, 0));
	const animate = props.animate !== false && animationDuration > 0;
	const easeFn = EASINGS[props.animationEasing] || easeCubicOut;

	const showTooltip = props.showTooltip !== false;
	const tooltipTemplate = isBlank(props.tooltipTemplate)
		? '<strong>{name}</strong><br/>{swatch}Total: {formattedValue}'
		: props.tooltipTemplate;
	const tooltipFollowCursor = props.tooltipFollowCursor !== false;
	const tooltipBackground = props.tooltipBackground || 'rgba(17,24,39,0.92)';
	const tooltipTextColor = props.tooltipTextColor || '#ffffff';
	const tooltipFontSize = num(props.tooltipFontSize, 12);

	const makeFmt = (spec) => {
		if (isBlank(spec)) return (n) => `${n}`;
		try { return format(spec); } catch (e) { return (n) => `${n}`; }
	};
	const fmt = makeFmt(props.valueFormat);
	const valueFmt = isBlank(props.nodeValueFormat) ? fmt : makeFmt(props.nodeValueFormat);

	// ----- clear previous render -----
	const root = select(container);
	root.selectAll('*').remove();

	// ----- dimensions -----
	const rect = container.getBoundingClientRect();
	const measuredW = Math.floor(rect.width) || container.clientWidth || 0;
	const width = Math.max(220, measuredW || 600);
	const height = Math.max(140, num(props.chartHeight, 420));

	// ----- root svg + background + click target -----
	const svg = root
		.append('svg')
		.attr('class', 'sc-svg')
		.attr('width', width)
		.attr('height', height)
		.attr('viewBox', `0 0 ${width} ${height}`)
		.style('font-family', fontFamily)
		.style('display', 'block');

	svg.append('rect')
		.attr('class', 'sc-bg')
		.attr('width', width)
		.attr('height', height)
		.attr('fill', backgroundColor);

	// ----- empty-state helper -----
	const emptyState = (msg) => {
		svg.append('text')
			.attr('x', width / 2).attr('y', height / 2)
			.attr('text-anchor', 'middle')
			.attr('fill', '#6b7280')
			.style('font-size', `${Math.max(12, nodeLabelFontSize)}px`)
			.text(msg);
	};

	// chart-level click fires after layout (knows node/link counts), but the bg
	// rect should still be clickable in the empty state.
	svg.on('click', () => { dispatch('CHART_CLICKED', { nodeCount: 0, linkCount: 0 }); });

	// ----- normalize the graph -----
	const graph = normalizeGraph(props.data);
	if (!graph.nodes.length || !graph.links.length) {
		emptyState('No data to display');
		return;
	}

	// ----- title (reserve vertical space) -----
	const titleH = chartTitle ? titleFontSize + 16 : 0;

	// ----- margins: leave room for outside labels on both edges -----
	const labelPad = showNodeLabels ? Math.max(40, nodeLabelFontSize * 6) : 8;
	const margin = {
		top: titleH + 6,
		right: showNodeLabels ? labelPad : 8,
		bottom: 6,
		left: showNodeLabels ? labelPad : 8
	};
	const innerW = Math.max(10, width - margin.left - margin.right);
	const innerH = Math.max(10, height - margin.top - margin.bottom);

	// ----- run the sankey layout (guard cycles + failures) -----
	const layout = sankey()
		.nodeId((d) => d.name)
		.nodeAlign(nodeAlign)
		.nodeWidth(nodeWidth)
		.nodePadding(nodePadding)
		.extent([[0, 0], [innerW, innerH]]);

	if (nodeSort === 'none') layout.nodeSort(null);
	else if (nodeSort === 'ascending') layout.nodeSort((a, b) => (a.value || 0) - (b.value || 0));
	else if (nodeSort === 'descending') layout.nodeSort((a, b) => (b.value || 0) - (a.value || 0));
	// 'auto' -> leave d3-sankey's default (undefined) sort in place

	let laid;
	try {
		// d3-sankey mutates the input; clone so a redraw starts clean and the
		// nodeId accessor resolves against fresh node objects each time.
		laid = layout({
			nodes: graph.nodes.map((n) => Object.assign({}, n)),
			links: graph.links.map((l) => Object.assign({}, l))
		});
	} catch (e) {
		// Circular links (or otherwise un-layout-able graphs) make d3-sankey throw.
		emptyState('Cannot render flow (check for circular links)');
		return;
	}
	const nodes = laid.nodes || [];
	const links = laid.links || [];
	if (!nodes.length) { emptyState('No data to display'); return; }

	// ----- per-node color -----
	const ordinal = scaleOrdinal().range(schemeColors);
	const colorFor = (node) => {
		if (useSeriesColors && node && node.color) return node.color;
		return ordinal(node.name);
	};
	// stable ordinal assignment by node order
	nodes.forEach((n) => { n._color = colorFor(n); });

	const brighten = (base) => {
		const c = color(base);
		return c ? c.brighter(0.5).toString() : base;
	};
	const hoverFill = (base) => (hoverColor ? hoverColor : brighten(base));

	const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	if (dropShadow) {
		const defs = svg.append('defs');
		const filter = defs.append('filter')
			.attr('id', 'sc-shadow')
			.attr('x', '-30%').attr('y', '-30%')
			.attr('width', '160%').attr('height', '160%');
		filter.append('feDropShadow')
			.attr('dx', 0).attr('dy', 1)
			.attr('stdDeviation', shadowBlur)
			.attr('flood-color', props.shadowColor || 'rgba(0,0,0,0.25)');
	}

	// ----- per-link gradient defs (only for gradient mode) -----
	if (linkColorMode === 'gradient') {
		const gdefs = svg.append('defs');
		links.forEach((l, i) => {
			l._gradId = `sc-grad-${i}`;
			const g = gdefs.append('linearGradient')
				.attr('id', l._gradId)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', l.source.x1).attr('x2', l.target.x0);
			g.append('stop').attr('offset', '0%').attr('stop-color', l.source._color);
			g.append('stop').attr('offset', '100%').attr('stop-color', l.target._color);
		});
	}

	const linkStroke = (l) => {
		if (linkColorMode === 'static') return linkStaticColor;
		if (linkColorMode === 'source') return l.source._color;
		if (linkColorMode === 'target') return l.target._color;
		return `url(#${l._gradId})`; // gradient
	};

	// ----- draw links (ribbons) -----
	const pathGen = sankeyLinkHorizontal();
	const linkLayer = plot.append('g')
		.attr('class', 'sc-links')
		.attr('fill', 'none');

	const linkSel = linkLayer.selectAll('path').data(links).join('path')
		.attr('class', 'sc-link')
		.attr('d', pathGen)
		.attr('stroke', linkStroke)
		.attr('stroke-opacity', linkOpacity)
		.attr('stroke-width', (l) => Math.max(1, l.width))
		.attr('stroke-linecap', linkCurvature < 0.15 ? 'butt' : 'round')
		.style('cursor', 'pointer');

	// ----- draw nodes (bars) -----
	const nodeLayer = plot.append('g')
		.attr('class', 'sc-nodes')
		.attr('filter', dropShadow ? 'url(#sc-shadow)' : null);

	const nodeSel = nodeLayer.selectAll('rect').data(nodes).join('rect')
		.attr('class', 'sc-node')
		.attr('x', (d) => d.x0)
		.attr('y', (d) => d.y0)
		.attr('height', (d) => Math.max(0, d.y1 - d.y0))
		.attr('width', (d) => Math.max(0, d.x1 - d.x0))
		.attr('rx', nodeCornerRadius)
		.attr('ry', nodeCornerRadius)
		.attr('fill', (d) => d._color)
		.attr('stroke', nodeStroke && nodeStrokeWidth > 0 ? nodeStroke : 'none')
		.attr('stroke-width', nodeStroke && nodeStrokeWidth > 0 ? nodeStrokeWidth : 0)
		.style('cursor', 'pointer');

	// ----- node labels -----
	const midX = innerW / 2;
	let labelSel = null;
	if (showNodeLabels) {
		labelSel = plot.append('g').attr('class', 'sc-labels')
			.selectAll('text').data(nodes).join('text')
			.attr('class', 'sc-label')
			.attr('y', (d) => (d.y0 + d.y1) / 2)
			.attr('dy', '0.35em')
			.attr('fill', nodeLabelColor)
			.style('font-size', `${nodeLabelFontSize}px`)
			.style('font-family', fontFamily)
			.style('pointer-events', 'none')
			.attr('x', (d) => {
				if (nodeLabelPosition === 'inside') return (d.x0 + d.x1) / 2;
				// outside / auto: leftmost-column nodes label to the right, others to the left,
				// unless the node sits left of center (then label to the right to stay in view).
				const labelRight = nodeLabelPosition === 'auto' ? (d.x0 < midX) : (d.x0 < midX);
				return labelRight ? d.x1 + 6 : d.x0 - 6;
			})
			.attr('text-anchor', (d) => {
				if (nodeLabelPosition === 'inside') return 'middle';
				return (d.x0 < midX) ? 'start' : 'end';
			})
			.text((d) => d.name);
		if (showNodeValues) {
			labelSel.append('tspan')
				.attr('class', 'sc-label-value')
				.attr('fill', nodeValueColor)
				.style('font-size', `${nodeValueFontSize}px`)
				.text((d) => ` (${valueFmt(d.value || 0)})`);
		}
	}

	// ----- tooltip -----
	const tooltipEl = showTooltip
		? root.append('div').attr('class', 'sc-tooltip')
			.style('background', tooltipBackground).style('color', tooltipTextColor)
			.style('font-size', `${tooltipFontSize}px`).style('font-family', fontFamily)
			.style('opacity', 0).style('display', 'none')
		: null;

	const escapeHtml = (s) => String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	const swatchHtml = (cssColor) => {
		const safe = String(cssColor).replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');
		return `<span class="sc-tt-swatch" style="background:${safe}"></span>`;
	};
	const renderNodeTooltip = (d) => {
		const col = d._color;
		const ctx = {
			name: d.name, value: d.value || 0, formattedValue: fmt(d.value || 0), color: col
		};
		return tooltipTemplate.replace(/\{(\w+)\}/g, (m, key) => {
			if (key === 'swatch') return swatchHtml(col);
			const v = ctx[key];
			return (v === undefined || v === null) ? '' : escapeHtml(v);
		});
	};
	const renderLinkTooltip = (l) => {
		const col = linkColorMode === 'static' ? linkStaticColor
			: (linkColorMode === 'target' ? l.target._color : l.source._color);
		return `${swatchHtml(col)}<strong>${escapeHtml(l.source.name)}</strong> &rarr; `
			+ `<strong>${escapeHtml(l.target.name)}</strong><br/>${escapeHtml(fmt(l.value))}`;
	};
	const placeTooltip = (clientX, clientY) => {
		if (!tooltipEl) return;
		const cr = container.getBoundingClientRect();
		const node = tooltipEl.node();
		const tw = node.offsetWidth;
		const th = node.offsetHeight;
		let xPos = clientX - cr.left + 14;
		let yPos = clientY - cr.top + 14;
		if (yPos + th > cr.height) yPos = clientY - cr.top - th - 14;
		if (xPos + tw > cr.width) xPos = cr.width - tw - 4;
		if (xPos < 0) xPos = 4;
		if (yPos < 0) yPos = 4;
		tooltipEl.style('left', `${xPos}px`).style('top', `${yPos}px`);
	};
	const hideTooltip = () => { if (tooltipEl) tooltipEl.style('opacity', 0).style('display', 'none'); };

	// ----- hover highlighting helpers -----
	const linkTouchesNode = (l, node) => l.source === node || l.target === node;
	const dimAll = (activeLinks, activeNodes) => {
		if (hoverDimOthers) {
			linkSel.attr('stroke-opacity', (l) => (activeLinks.indexOf(l) > -1 ? linkHoverOpacity : Math.min(linkOpacity, 0.08)));
			nodeSel.style('opacity', (n) => (activeNodes.indexOf(n) > -1 ? 1 : 0.25));
			if (labelSel) labelSel.style('opacity', (n) => (activeNodes.indexOf(n) > -1 ? 1 : 0.25));
		} else if (hoverHighlight) {
			linkSel.attr('stroke-opacity', (l) => (activeLinks.indexOf(l) > -1 ? linkHoverOpacity : linkOpacity));
		}
	};
	const resetHighlight = () => {
		linkSel.attr('stroke-opacity', linkOpacity);
		nodeSel.style('opacity', 1).attr('fill', (d) => d._color);
		if (labelSel) labelSel.style('opacity', 1);
	};

	// ----- node interaction -----
	nodeSel
		.on('mouseenter', function (event, d) {
			if (hoverHighlight || hoverDimOthers) {
				const activeLinks = links.filter((l) => linkTouchesNode(l, d));
				const activeNodes = [d];
				activeLinks.forEach((l) => {
					const other = l.source === d ? l.target : l.source;
					if (activeNodes.indexOf(other) === -1) activeNodes.push(other);
				});
				dimAll(activeLinks, activeNodes);
				if (hoverHighlight) select(this).attr('fill', hoverFill(d._color));
			}
			if (tooltipEl) {
				tooltipEl.html(renderNodeTooltip(d)).style('display', 'block').style('opacity', 1);
				placeTooltip(event.clientX, event.clientY);
			}
			dispatch('NODE_HOVERED', { name: d.name, value: d.value || 0 });
		})
		.on('mousemove', function (event) { placeTooltip(event.clientX, event.clientY); })
		.on('mouseleave', function () { resetHighlight(); hideTooltip(); })
		.on('click', function (event, d) {
			event.stopPropagation();
			dispatch('NODE_CLICKED', { name: d.name, value: d.value || 0, index: d.index });
		});

	// ----- link interaction -----
	linkSel
		.on('mouseenter', function (event, l) {
			if (linkHover || hoverHighlight || hoverDimOthers) {
				const activeNodes = [l.source, l.target];
				dimAll([l], activeNodes);
				select(this).attr('stroke-opacity', linkHoverOpacity);
				if (linkHover) {
					nodeSel.attr('fill', (n) => (n === l.source || n === l.target ? hoverFill(n._color) : n._color));
				}
			}
			if (tooltipEl) {
				tooltipEl.html(renderLinkTooltip(l)).style('display', 'block').style('opacity', 1);
				placeTooltip(event.clientX, event.clientY);
			}
		})
		.on('mousemove', function (event) { placeTooltip(event.clientX, event.clientY); })
		.on('mouseleave', function () { resetHighlight(); hideTooltip(); })
		.on('click', function (event, l) {
			event.stopPropagation();
			dispatch('LINK_CLICKED', { source: l.source.name, target: l.target.name, value: l.value });
		});

	// ----- chart-level click reports real counts now that layout exists -----
	svg.on('click', () => { dispatch('CHART_CLICKED', { nodeCount: nodes.length, linkCount: links.length }); });

	// ----- title -----
	if (chartTitle) {
		svg.append('text').attr('class', 'sc-title')
			.attr('x', width / 2)
			.attr('y', titleFontSize + 2)
			.attr('text-anchor', 'middle').attr('fill', titleColor)
			.style('font-size', `${titleFontSize}px`).style('font-weight', '600')
			.text(chartTitle);
	}

	// ----- grow-in animation (nodes grow from their vertical center; links thin -> full) -----
	if (animate && typeof requestAnimationFrame === 'function') {
		const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : new Date().getTime());
		const t0 = now();
		// snapshot full geometry
		const nodeGeom = nodes.map((d) => ({ cy: (d.y0 + d.y1) / 2, h: Math.max(0, d.y1 - d.y0), y0: d.y0 }));
		const linkFull = links.map((l) => Math.max(1, l.width));
		const maxDelay = animationStagger * Math.max(0, Math.max(nodes.length, links.length) - 1);
		const kAt = (elapsed, i) => easeFn(Math.max(0, Math.min(1, (elapsed - animationStagger * i) / animationDuration)));
		nodeSel.attr('y', (d, i) => nodeGeom[i].cy).attr('height', 0);
		linkSel.attr('stroke-width', 0).attr('stroke-opacity', 0);
		if (labelSel) labelSel.style('opacity', 0);
		const tick = () => {
			const elapsed = now() - t0;
			nodeSel.attr('y', (d, i) => nodeGeom[i].cy - (nodeGeom[i].h * kAt(elapsed, i)) / 2)
				.attr('height', (d, i) => nodeGeom[i].h * kAt(elapsed, i));
			linkSel.attr('stroke-width', (l, i) => linkFull[i] * kAt(elapsed, i))
				.attr('stroke-opacity', (l, i) => linkOpacity * kAt(elapsed, i));
			if (elapsed < animationDuration + maxDelay) requestAnimationFrame(tick);
			else {
				nodeSel.attr('y', (d, i) => nodeGeom[i].y0).attr('height', (d, i) => nodeGeom[i].h);
				linkSel.attr('stroke-width', (l, i) => linkFull[i]).attr('stroke-opacity', linkOpacity);
				if (labelSel) labelSel.style('opacity', 1);
			}
		};
		requestAnimationFrame(tick);
		if (labelSel) {
			labelSel.style('transition', `opacity 300ms ease ${Math.round((animationDuration + maxDelay) * 0.6)}ms`);
			requestAnimationFrame(() => labelSel.style('opacity', 1));
		}
	}
}
