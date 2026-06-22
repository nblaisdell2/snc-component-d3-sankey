/**
 * Script for the "D3 Sankey Data" Transform data resource
 * (table: sys_ux_data_broker_transform, "Mutates server data" = false).
 *
 * Paste this into the data resource's Script field. `input` is an object whose
 * keys are the data resource's Properties (see d3-sankey-data.properties.json).
 * The returned value is the data resource output, bound in UI Builder via
 *   @data.<data_resource_name>.output
 * to the component's "Data · Graph data" property.
 *
 * All heavy lifting lives in the global D3SankeyData Script Include. Unlike the
 * line/column chart (whose D3ChartData produces a `series` array), this produces
 * a GRAPH object { nodes, links } by grouping on a source field AND a target
 * field.
 */
function transform(input) {
	return new global.D3SankeyData().fromAggregate(input);
}
