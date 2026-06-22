/**
 * Sanity test for the D3SankeyData Script Include.
 * Run in System Definition → Scripts - Background (Global scope) AFTER creating
 * the D3SankeyData Script Include. It logs the { nodes, links } graph JSON so you
 * can confirm the shape before wiring it into the page. Adjust the cfg objects to
 * your data.
 */
(function () {
	var api = new global.D3SankeyData();

	gs.info('--- fromAggregate: contact_type -> state (count) ---');
	gs.info(JSON.stringify(api.fromAggregate({
		table: 'incident',
		sourceField: 'contact_type',
		targetField: 'state',
		metric: 'count',
		useDisplayValue: true
	}), null, 2));

	gs.info('--- fromAggregate: priority -> assignment_group, prefixed stages ---');
	gs.info(JSON.stringify(api.fromAggregate({
		table: 'incident',
		sourceField: 'priority',
		targetField: 'assignment_group',
		metric: 'count',
		useDisplayValue: true,
		prefixStages: true
	}), null, 2));

	gs.info('--- fromRows: reshape plain objects (dup links summed) ---');
	var rows = [
		{ from: 'Phone', to: 'Triage', n: 12 },
		{ from: 'Email', to: 'Triage', n: 8 },
		{ from: 'Triage', to: 'Resolved', n: 15 },
		{ from: 'Triage', to: 'Resolved', n: 5 },
		{ from: 'Resolved', to: 'Closed', n: 18 }
	];
	gs.info(JSON.stringify(api.fromRows(rows, {
		sourceField: 'from', targetField: 'to', valueField: 'n', metric: 'sum'
	}), null, 2));
})();
