declare module 'd3-scale' {
	// Minimal local declarations for dashboard chart usage.
	export type ScaleUtc = {
		(value: Date | number): number;
		copy(): ScaleUtc;
		domain(): Date[];
		domain(domain: Iterable<Date | number>): ScaleUtc;
		nice(): ScaleUtc;
		range(): number[];
		range(range: Iterable<number>): ScaleUtc;
	};

	export function scaleUtc(): ScaleUtc;
}

declare module 'd3-shape' {
	export type CurveFactory = (context: unknown) => unknown;

	export const curveMonotoneX: CurveFactory;
}
