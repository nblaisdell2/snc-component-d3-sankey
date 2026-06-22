/**
 * D3SankeyData — Script Include (global, accessible from all application scopes)
 * ---------------------------------------------------------------------------
 * Reusable transform that turns platform data into the GRAPH shape expected by
 * the x-1295779-sankey-chart-uic component's "Data · Graph data" property:
 *
 *   {
 *     nodes: [ { name: "<stage>", color?: "#hex" }, ... ],
 *     links: [ { source: "<name>", target: "<name>", value: <number> }, ... ]
 *   }
 *
 * This DIFFERS from the line/column chart's D3ChartData, which produces a
 * `series` array (categorical x + value y). A Sankey models FLOWS BETWEEN nodes,
 * so the output is a node set + a link set built by grouping on TWO fields (a
 * source field and a target field) rather than one category field.
 *
 * Two entry points:
 *   - fromAggregate(cfg)  : server-side GlideAggregate grouped by sourceField AND
 *                           targetField (count/sum/avg/min/max).
 *   - fromRows(rows, cfg) : reshape an array of already-fetched plain objects.
 *
 * Written in ES5 for broad scoped/global compatibility (no let/const, arrow
 * functions, or template literals).
 */
var D3SankeyData = Class.create();
D3SankeyData.prototype = {

	initialize: function () {},

	/**
	 * Aggregate a table into a Sankey graph.
	 * cfg: {
	 *   table, filter,
	 *   sourceField,            // field whose value is the link's SOURCE node
	 *   targetField,            // field whose value is the link's TARGET node
	 *   metric (count|sum|avg|min|max),
	 *   valueField (required if metric!=count),
	 *   useDisplayValue (default true),
	 *   colors,                 // optional node colors: array (by order) or { name: color } map
	 *   prefixStages (default false)   // see _build()
	 * }
	 */
	fromAggregate: function (cfg) {
		cfg = cfg || {};
		var table = this._str(cfg.table);
		var sourceField = this._str(cfg.sourceField);
		var targetField = this._str(cfg.targetField);
		if (!table || !sourceField || !targetField) {
			return { nodes: [], links: [] };
		}
		var metric = (this._str(cfg.metric) || 'count').toLowerCase();
		var valueField = this._str(cfg.valueField);
		var useDisplay = cfg.useDisplayValue !== false && cfg.useDisplayValue !== 'false';
		if (metric !== 'count' && !valueField) {
			return { nodes: [], links: [] }; // sum/avg/min/max need a numeric field
		}

		var ga = new GlideAggregate(table);
		if (this._str(cfg.filter)) {
			ga.addEncodedQuery(cfg.filter);
		}
		ga.groupBy(sourceField);
		ga.groupBy(targetField);
		if (metric === 'count') {
			ga.addAggregate('COUNT');
		} else {
			ga.addAggregate(metric.toUpperCase(), valueField);
		}
		ga.query();

		var rows = [];
		while (ga.next()) {
			var sVal = useDisplay ? ga.getDisplayValue(sourceField) : ga.getValue(sourceField);
			var tVal = useDisplay ? ga.getDisplayValue(targetField) : ga.getValue(targetField);
			var value;
			if (metric === 'count') {
				value = parseInt(ga.getAggregate('COUNT'), 10);
			} else {
				value = parseFloat(ga.getAggregate(metric.toUpperCase(), valueField));
			}
			rows.push({
				source: this._blank(sVal),
				target: this._blank(tVal),
				value: isNaN(value) ? 0 : value
			});
		}
		return this._build(rows, cfg);
	},

	/**
	 * Reshape an array of plain objects into a Sankey graph.
	 * cfg: { sourceField, targetField, valueField, metric? (dup combine; default sum),
	 *        colors, prefixStages }
	 * Duplicate (source,target) pairs are combined (summed by default).
	 */
	fromRows: function (rows, cfg) {
		cfg = cfg || {};
		rows = rows || [];
		var sourceField = this._str(cfg.sourceField);
		var targetField = this._str(cfg.targetField);
		var valueField = this._str(cfg.valueField);

		var collected = [];
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i] || {};
			var value = parseFloat(this._readField(r, valueField));
			collected.push({
				source: this._blank(this._readField(r, sourceField)),
				target: this._blank(this._readField(r, targetField)),
				value: isNaN(value) ? 0 : value
			});
		}
		return this._build(collected, cfg, (this._str(cfg.metric) || 'sum').toLowerCase());
	},

	// ----- internals -------------------------------------------------------

	/**
	 * Build the { nodes, links } graph from flat rows {source, target, value}.
	 * dupMetric: how to combine duplicate (source,target) pairs (null = sum).
	 *
	 * prefixStages: when true, the SAME value appearing as both a source and a
	 * target is split into two distinct nodes by prefixing ("From: X" / "To: X").
	 * This is useful when stages can recur (e.g. a status that is both an origin
	 * and a destination) and you don't want a self-referential collapse. When
	 * false (default), source and target values that match become one shared node
	 * (the natural multi-stage flow).
	 */
	_build: function (rows, cfg, dupMetric) {
		var prefix = cfg.prefixStages === true || cfg.prefixStages === 'true';
		var srcLabel = function (v) { return prefix ? ('From: ' + v) : v; };
		var tgtLabel = function (v) { return prefix ? ('To: ' + v) : v; };
		var metric = dupMetric || 'sum';

		var nodeOrder = [];
		var nodeSeen = {};
		var addNode = function (name) {
			if (!nodeSeen[name]) { nodeSeen[name] = true; nodeOrder.push(name); }
		};

		var linkKeys = [];
		var linkMap = {};
		var linkCnt = {};
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			var s = srcLabel(row.source);
			var t = tgtLabel(row.target);
			if (s === '(empty)' || t === '(empty)') { continue; }
			if (s === t) { continue; } // d3-sankey can't lay out a self-loop
			addNode(s);
			addNode(t);
			var key = s + '' + t;
			if (linkMap[key] === undefined) {
				linkMap[key] = row.value;
				linkCnt[key] = 1;
				linkKeys.push({ key: key, source: s, target: t });
			} else {
				if (metric === 'min') { linkMap[key] = Math.min(linkMap[key], row.value); }
				else if (metric === 'max') { linkMap[key] = Math.max(linkMap[key], row.value); }
				else { linkMap[key] += row.value; }
				linkCnt[key]++;
			}
		}
		if (metric === 'avg') {
			for (var k in linkMap) { if (linkMap.hasOwnProperty(k)) { linkMap[k] = linkMap[k] / linkCnt[k]; } }
		}

		var parsedColors = this._parseColors(cfg.colors);
		var nodes = [];
		for (var n = 0; n < nodeOrder.length; n++) {
			var entry = { name: String(nodeOrder[n]) };
			var color = this._colorFor(parsedColors, nodeOrder[n], n);
			if (color) { entry.color = color; }
			nodes.push(entry);
		}

		var links = [];
		for (var j = 0; j < linkKeys.length; j++) {
			var lk = linkKeys[j];
			var val = linkMap[lk.key];
			if (!val || val <= 0) { continue; } // drop zero/negative flows
			links.push({ source: String(lk.source), target: String(lk.target), value: val });
		}

		return { nodes: nodes, links: links };
	},

	_parseColors: function (colors) {
		if (!colors) { return null; }
		if (typeof colors === 'string') {
			var s = colors.replace(/^\s+|\s+$/g, '');
			if (!s) { return null; }
			try {
				colors = JSON.parse(s);
			} catch (e) {
				colors = s.split(',');
				for (var i = 0; i < colors.length; i++) {
					colors[i] = colors[i].replace(/^\s+|\s+$/g, '');
				}
			}
		}
		if (Object.prototype.toString.call(colors) === '[object Array]') {
			return { type: 'array', value: colors };
		}
		if (typeof colors === 'object') {
			return { type: 'map', value: colors };
		}
		return null;
	},

	_colorFor: function (parsed, label, index) {
		if (!parsed) { return null; }
		if (parsed.type === 'array') {
			if (!parsed.value.length) { return null; }
			return parsed.value[index % parsed.value.length];
		}
		if (parsed.type === 'map') {
			return parsed.value[label] || null;
		}
		return null;
	},

	_readField: function (obj, field) {
		if (!field) { return ''; }
		var v = obj[field];
		if (v && typeof v === 'object') {
			if (typeof v.getDisplayValue === 'function') { return v.getDisplayValue(); }
			if (v.displayValue !== undefined) { return v.displayValue; }
			if (v.value !== undefined) { return v.value; }
		}
		return (v === undefined || v === null) ? '' : v;
	},

	_str: function (v) {
		return (v === undefined || v === null) ? '' : ('' + v).replace(/^\s+|\s+$/g, '');
	},

	_blank: function (v) {
		var s = (v === undefined || v === null) ? '' : ('' + v);
		return s === '' ? '(empty)' : s;
	},

	type: 'D3SankeyData'
};
