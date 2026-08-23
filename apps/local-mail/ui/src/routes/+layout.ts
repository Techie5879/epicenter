// The triage UI is a client-only SPA served from disk by `local-mail app`
// (adapter-static + fallback). No SSR, no prerender: the browser owns routing
// and every byte of state comes from `/api` behind the per-launch bearer.
export const ssr = false;
export const prerender = false;
