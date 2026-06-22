/**
 * Built-in sample data so the component renders something meaningful the moment
 * it is dropped onto a page, before the author binds the `data` property to a
 * real data resource.
 *
 * Unlike the line/column charts (which take a `series` array of
 * { name, color, data: [{ label, value }] }), a Sankey models FLOWS between
 * nodes. The data is a single GRAPH object with two arrays:
 *
 *   {
 *     nodes: [ { name, color? }, ... ],
 *     links: [ { source, target, value }, ... ]   // source/target = node name or index
 *   }
 *
 * This sample is a ticket-lifecycle flow: how incidents move from intake
 * channels through triage, work, and final disposition.
 */
export const SAMPLE_DATA = {
	nodes: [
		{ name: 'Phone', color: '#2E93fA' },
		{ name: 'Email', color: '#26C6DA' },
		{ name: 'Portal', color: '#7E57C2' },
		{ name: 'Triage', color: '#FF9800' },
		{ name: 'In Progress', color: '#FFC107' },
		{ name: 'Escalated', color: '#EF5350' },
		{ name: 'Resolved', color: '#66BB6A' },
		{ name: 'Closed', color: '#43A047' },
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
