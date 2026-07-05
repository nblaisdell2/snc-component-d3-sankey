import { createCustomElement, actionTypes } from "@servicenow/ui-core";
import snabbdom from "@servicenow/ui-renderer-snabbdom";
import styles from "./styles.scss";
import { drawChart } from "./chart";
import { SAMPLE_DATA } from "./sampleData";

const {
	COMPONENT_RENDERED,
	COMPONENT_DOM_READY,
	COMPONENT_PROPERTY_CHANGED,
	COMPONENT_DISCONNECTED,
} = actionTypes;

/**
 * The view only renders a single stable container. D3 owns everything inside it
 * and is driven imperatively from the lifecycle action handlers below — mixing
 * snabbdom's virtual DOM with D3's direct DOM mutation on the same nodes is what
 * you want to avoid, so we keep them on separate elements.
 */
const view = () => <div className="sc-root" />;

/** Resolve the D3 mount node inside the (open) shadow root. */
const getContainer = (host) =>
	host && host.shadowRoot
		? host.shadowRoot.querySelector(".sc-root") ||
			host.shadowRoot.querySelector("div")
		: null;

/** Coerce a UI Builder value into a CSS length ("50%", "12px"; bare numbers -> px). */
const cssLen = (v, fallback) => {
	if (v === undefined || v === null || v === "") return fallback;
	return /^\d+(\.\d+)?$/.test(String(v)) ? `${v}px` : String(v);
};

/** True when the bound `data` is a usable graph (has at least one node). */
const hasGraph = (g) =>
	g && typeof g === "object" && Array.isArray(g.nodes) && g.nodes.length > 0;

/** Render with the sample-data fallback applied when `data` is empty. */
const render = ({ host, properties, dispatch }) => {
	const container = getContainer(host);
	if (!container) return;
	// Configurable outer footprint so the widget need not span the full page width.
	host.style.display = "block";
	host.style.boxSizing = "border-box";
	host.style.width = cssLen(properties.componentWidth, "100%");
	host.style.maxWidth = "100%";
	host.style.padding = cssLen(properties.componentPadding, "0");
	// optional widget border (Header & border section)
	const borderW = parseFloat(properties.borderWidth) || 0;
	host.style.border =
		properties.borderColor && borderW > 0
			? `${borderW}px solid ${properties.borderColor}`
			: "none";
	host.style.borderRadius = cssLen(properties.borderRadius, "0");
	const data = hasGraph(properties.data) ? properties.data : SAMPLE_DATA;
	const effectiveProps = { ...properties, data };
	// stash latest inputs so the ResizeObserver can redraw on container resize
	host._scLast = { container, props: effectiveProps, dispatch };
	try {
		drawChart(container, effectiveProps, dispatch);
		// Record the width we just drew at so the ResizeObserver can distinguish a real
		// resize from its own initial/no-op callback — that callback would otherwise
		// repaint with animation off and snap the grow-in straight to its end state.
		host._scWidth =
			container.getBoundingClientRect().width || container.clientWidth || 0;
	} catch (e) {
		// Safety net: surface a render failure instead of failing silently.
		container.textContent = `Chart error: ${e && e.message ? e.message : String(e)}`;
		// eslint-disable-next-line no-console
		if (typeof console !== "undefined")
			console.error("[sankey-chart] render failed", e);
	}
};

createCustomElement("x-2114311-sankey-chart-uic", {
	renderer: { type: snabbdom },
	view,
	styles,
	properties: {
		// Keep in sync with now-ui.json. JSON-typed defaults (data, palette) live HERE.
		data: { default: SAMPLE_DATA },
		chartTitle: { default: "Ticket Lifecycle Flow" },
		titleFontSize: { default: 18 },
		titleColor: { default: "#374151" },
		componentWidth: { default: "100%" },
		componentPadding: { default: "12px" },
		backgroundColor: { default: "transparent" },
		borderColor: { default: "" },
		borderWidth: { default: 0 },
		borderRadius: { default: 0 },
		chartHeight: { default: 420 },
		animate: { default: true },
		animationDuration: { default: 800 },
		animationEasing: { default: "cubicOut" },
		animationStagger: { default: 0 },
		fontFamily: { default: "" },
		hoverColor: { default: "" },
		dropShadow: { default: false },
		shadowColor: { default: "rgba(0,0,0,0.25)" },
		shadowBlur: { default: 4 },
		nodeAlign: { default: "justify" },
		nodeWidth: { default: 16 },
		nodePadding: { default: 12 },
		nodeCornerRadius: { default: 2 },
		nodeStroke: { default: "" },
		nodeStrokeWidth: { default: 0 },
		nodeSort: { default: "auto" },
		linkColorMode: { default: "gradient" },
		linkStaticColor: { default: "#94a3b8" },
		linkOpacity: { default: 0.45 },
		linkHoverOpacity: { default: 0.75 },
		linkCurvature: { default: 0.5 },
		linkHover: { default: true },
		hoverHighlight: { default: true },
		hoverDimOthers: { default: true },
		useSeriesColors: { default: true },
		colorScheme: { default: "tableau10" },
		colorPalette: {
			default: [
				"#2E93fA",
				"#66DA26",
				"#546E7A",
				"#E91E63",
				"#FF9800",
				"#9C27B0",
			],
		},
		showNodeLabels: { default: true },
		nodeLabelPosition: { default: "auto" },
		nodeLabelFontSize: { default: 12 },
		nodeLabelColor: { default: "#374151" },
		showNodeValues: { default: false },
		nodeValueFontSize: { default: 9 },
		nodeValueColor: { default: "#ffffff" },
		nodeValueFormat: { default: "" },
		valueFormat: { default: "" },
		showTooltip: { default: true },
		tooltipTemplate: {
			default: "<strong>{name}</strong><br/>{swatch}Total: {formattedValue}",
		},
		tooltipFollowCursor: { default: true },
		tooltipBackground: { default: "rgba(17,24,39,0.92)" },
		tooltipTextColor: { default: "#ffffff" },
		tooltipFontSize: { default: 12 },
	},
	actionHandlers: {
		// Fires after each (re)render — covers initial paint.
		[COMPONENT_RENDERED]: render,
		// The view is static (doesn't read props), so a property change won't always
		// re-render it. Redraw explicitly when any UI Builder property changes.
		[COMPONENT_PROPERTY_CHANGED]: render,
		// First reliable DOM: wire a ResizeObserver so the chart is responsive to
		// its UI Builder slot without re-animating on every property tweak.
		[COMPONENT_DOM_READY]: (coeffects) => {
			const { host } = coeffects;
			render(coeffects);
			if (typeof ResizeObserver !== "undefined" && !host._scResizeObserver) {
				const ro = new ResizeObserver(() => {
					const last = host._scLast;
					if (!last || !last.container) return;
					const w =
						last.container.getBoundingClientRect().width ||
						last.container.clientWidth ||
						0;
					const prevW = host._scWidth || 0;
					// Only redraw on a genuine width change. observe() fires an initial
					// no-op callback; ignoring it (and height-only changes) keeps the
					// initial grow-in animation from being snapped to its end state.
					if (Math.abs(w - prevW) < 1) return;
					const wasUnsized = prevW < 1; // first real width after a 0-width initial measure
					host._scWidth = w;
					drawChart(
						last.container,
						{ ...last.props, animate: wasUnsized ? last.props.animate : false },
						last.dispatch,
					);
				});
				const target = getContainer(host);
				if (target) {
					ro.observe(target);
					host._scResizeObserver = ro;
				}
			}
		},
		[COMPONENT_DISCONNECTED]: ({ host }) => {
			if (host._scResizeObserver) {
				host._scResizeObserver.disconnect();
				host._scResizeObserver = null;
			}
		},
	},
});
