# PostHog Reverse Proxy

A Cloudflare Worker that acts as a reverse proxy for PostHog for our landing page. This proxy routes requests to PostHog through our own domain (`proxy.epicenter.so`).

## Development

```bash
bun dev:posthog-reverse-proxy
```

This starts Wrangler from the repo root.

- [PostHog Proxy Documentation](https://posthog.com/docs/advanced/proxy/cloudflare)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
