# Why Epicenter Uses Bearer Tokens Everywhere

I spent a while going back and forth on this. httpOnly cookies are what OWASP recommends. Better Auth defaults to them. Every security blog says localStorage is dangerous. So why does Epicenter store auth tokens in localStorage and send them as Bearer headers?

Because the alternative is two auth paths, and two auth paths is worse than one.

## The setup

Epicenter has web apps (`zhongwen.epicenter.so`, `honeycrisp.epicenter.so`), a Tauri desktop app, and a Chrome extension. They all talk to `api.epicenter.so`. The question is how they authenticate.

Cookies work great for web apps. The browser handles everything: stores the token, sends it automatically, scopes it to the domain. Zero code.

But cookies don't work outside the browser. Tauri's webview has platform-specific cookie quirks (WebKit silently drops `Secure` cookies from `tauri://`). Chrome extensions can't send cookies cross-origin to your API. Native apps don't have a cookie jar at all.

Bearer tokens work everywhere. Store a string, send it in a header. That's the whole pattern.

## The security argument for cookies

The case for httpOnly cookies is real. If an attacker gets XSS on your app, they can't steal a token they can't read. With localStorage, `localStorage.getItem('zhongwen.auth.token')` gives them the token to exfiltrate and use from their own machine.

That's a genuine difference. But here's what it actually means in practice.

## What XSS actually does

If an attacker has XSS on your app, they can:

- Make authenticated requests as the user (the browser sends cookies automatically)
- Read any data the user can see
- Modify any data the user can modify
- Exfiltrate everything visible in the DOM

All of that works with httpOnly cookies. The cookie is sent automatically on every request the attacker's script makes. They don't need to read the token; they just use it through the browser.

The only thing httpOnly prevents is *exfiltration*: copying the token to use from another machine after the XSS is patched. That's a real attack vector, but it's a narrow one. The vast majority of XSS damage happens during the session, not after it.

I wrote about this in [Origin Allowlists Don't Stop XSS](./origin-allowlists-dont-stop-xss.md):

| Factor              | Can XSS access? | Security value |
|---------------------|-----------------|----------------|
| Origin header       | Yes (automatic) | Low            |
| Cookies (same-site) | Yes             | Low            |
| LocalStorage        | Yes             | Low            |
| Server-side secrets | No              | High           |

Cookies and localStorage are in the same tier. The real security boundary is keeping secrets out of the browser entirely.

## The cost of two auth paths

To use cookies for web apps and Bearer tokens for everything else, you'd need:

1. Server-side `crossSubDomainCookies` config (ties you to `*.epicenter.so`)
2. Client-side branching: web apps use `credentials: 'include'`, extensions use `Authorization` headers
3. Two code paths through every auth-related feature
4. Two sets of bugs to find

That last point matters more than it sounds. Auth code is where security vulnerabilities hide. Every branch doubles the surface area. A bug in the cookie path doesn't get caught by tests that exercise the Bearer path, and vice versa.

One auth path means one set of behaviors to test, one set of edge cases, one mental model. When something breaks, you know exactly where to look.

## The domain coupling problem

`crossSubDomainCookies` sets `Domain=.epicenter.so` on cookies, so any `*.epicenter.so` subdomain can send them. Epicenter actually shipped this for a while, then deleted it: the knob doesn't exist in the codebase anymore. Production cookies today are host-only, `SameSite=Lax`, scoped to `api.epicenter.so`, and the only consumer is the dashboard the API serves from its own origin. Every cross-origin client, including web apps on their own subdomains, authenticates as a bearer client instead. That is the domain coupling problem made concrete: the moment an app moves to its own domain (`zhongwen.studio`, say), a `Domain=.epicenter.so` cookie stops being sent. You'd need `SameSite=None` (weaker CSRF posture) or a reverse proxy to make it work again, and you'd still be back here for the next app that isn't on `*.epicenter.so`.

Bearer tokens don't care what domain the app is on. The token is a string. Send it from anywhere.

## What OWASP actually says

OWASP recommends httpOnly cookies. They're right in isolation; if you're choosing between localStorage and cookies for a browser-only app with one domain, pick cookies.

But OWASP also says the real defense against XSS is preventing it: Content-Security-Policy headers, input sanitization, output encoding. If your security model depends on the attacker not being able to read localStorage, you've already lost. The attacker is running arbitrary JavaScript in your user's session.

## The decision

Bearer tokens everywhere. One auth path for all clients. The security delta between httpOnly cookies and localStorage is real but narrow (exfiltration prevention only), and the simplicity of a single auth strategy outweighs it.

If this calculus changes (we drop non-browser clients, or we start handling data sensitive enough that token exfiltration becomes the primary threat model), we revisit. We've already tried the cookie route once, with `crossSubDomainCookies`, and deleted it; switching back would mean re-introducing a `Domain=.epicenter.so` cookie and its wider CSRF surface, not flipping a config flag. But for now, simplicity wins.

## See also

- [Bearer Tokens Are Cookies Without the Cookie Jar](./bearer-tokens-are-cookies-without-the-cookie-jar.md)
- [Origin Allowlists Don't Stop XSS](./origin-allowlists-dont-stop-xss.md)
