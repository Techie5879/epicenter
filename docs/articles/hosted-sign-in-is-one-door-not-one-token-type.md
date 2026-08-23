# Hosted Sign-In Is One Door, Not One Token Type

Historical note: this article reflects the superseded cookie-family versus bearer-family design. The active direction: every app is an OAuth client, `/auth/oauth-session` is replaced by `GET /auth/me`, and Better Auth cookies stay inside the hosted API auth server.

Hosted sign-in does not mean every app should use the same auth transport. It means every app sends the user to the same trusted place to prove who they are. After that, the app still needs the credential shape that fits its runtime.

That gives us one public action:

```ts
await auth.beginSignIn({ returnTo });
```

But it does not give us one private implementation.

```txt
App UI
  "Sign in to Epicenter"
        |
        v
  auth.beginSignIn()
        |
        v
Hosted Epicenter /sign-in
        |
        +--> cookie app gets a cookie
        |
        +--> bearer app gets OAuth code + PKCE + bearer session
```

The method name is not the architecture. `beginSignIn`, `startHostedSignIn`, or `requestSignIn` could all work. The important part is what the method refuses to expose.

It does not ask the app which provider to show. It does not ask the app whether this is email/password, Google, passkeys, recovery, or MFA. It does not ask the app to handle a token directly.

The app only says: start sign-in.

## Cookie apps should not do OAuth just to get a cookie

A cookie app has the simplest story. The browser goes to the hosted sign-in page. The auth server sets an HttpOnly cookie. The browser carries that cookie afterward.

```txt
1. App calls:
   auth.beginSignIn({ returnTo: "/dashboard" })

2. Browser navigates:
   /sign-in?callbackURL=/dashboard

3. User signs in on hosted page:
   email/password, Google, future passkey, whatever

4. Better Auth sets:
   HttpOnly session cookie

5. Browser returns:
   /dashboard

6. App asks:
   /auth/get-session

7. Browser includes:
   Cookie: better-auth session
```

JavaScript never sees the session token. That is the point. The browser cookie jar owns the credential, and the server can set flags like HttpOnly and Secure.

So for cookie apps, OAuth would mostly be ceremony. We would create an authorization code just to end up with the same thing: a cookie session. That adds moving parts without buying much.

```txt
Cookie app normal sign-in:
  direct /sign-in

Cookie app should not do this:
  /auth/oauth2/authorize
    -> /sign-in
    -> code
    -> token
    -> cookie
```

The cookie path is boring because boring is correct here.

## Bearer apps need a code handoff

Bearer apps are different. A browser extension, desktop app, CLI, daemon, or cross-origin app cannot honestly rely on Epicenter's first-party cookie jar. It needs an app-owned credential.

But we still should not put the durable token in the redirect URL.

```txt
Bad:
  /callback?token=durable-session-token

Better:
  /callback?code=temporary-code&state=random-state
```

The redirect carries a temporary OAuth code. The app exchanges that code for a token after it proves it is the same app that started the flow.

That proof is PKCE.

```txt
1. App creates:
   code_verifier = secret random string

2. App sends:
   code_challenge = hash(code_verifier)

3. Hosted auth later redirects:
   /callback?code=abc&state=xyz

4. App exchanges:
   code + original code_verifier

5. Server checks:
   hash(code_verifier) matches original challenge

6. Server returns:
   access token
```

PKCE is not the token. PKCE is the lock around the code-to-token exchange.

Without PKCE, stealing the code is enough.

```txt
attacker gets code
attacker exchanges code
attacker gets token
```

With PKCE, stealing the code is not enough.

```txt
attacker gets code
attacker does not have verifier
token exchange fails
```

That is why PKCE belongs to bearer OAuth flows. It is not needed for normal cookie sign-in because cookie sign-in does not hand a code back to app JavaScript.

## Epicenter bearer apps need one more exchange

Epicenter has one extra requirement: the app does not only need a Better Auth token. It needs the full local-first identity.

```ts
type BearerSession = {
	token: string;
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};
```

The OAuth access token proves the user completed hosted sign-in, but the app still needs Epicenter's durable bearer session shape.

```txt
Bearer app
  beginSignIn()
      |
      v
  /auth/oauth2/authorize with PKCE
      |
      v
  hosted /sign-in
      |
      v
  redirect_uri?code&state
      |
      v
  exchange code for OAuth access token
      |
      v
  POST /auth/oauth-session
      |
      v
  BearerSession { token, user, encryptionKeys }
```

That final `/auth/oauth-session` step is the bridge from OAuth proof to Epicenter workspace unlock.

## The boundary to keep

This is the split to protect:

```txt
App UI owns:
  one button
  one call to beginSignIn()

Hosted sign-in owns:
  credentials
  provider choice
  account creation
  recovery
  future MFA or passkeys

Auth factory owns:
  cookie completion or bearer completion

OAuth launcher owns:
  PKCE
  redirect URI
  extension popup
  desktop callback
```

That means `@epicenter/auth` should not learn Chrome extension callback rules. It should not learn Tauri deep links. It should not decide whether the current app is on a trusted cookie boundary.

It should receive a launcher.

```txt
Cookie factory launcher:
  navigate to /sign-in

Bearer factory launcher:
  run OAuth + PKCE
  return accessToken or null
```

The public app API stays small:

```ts
auth.beginSignIn();
auth.signOut();
auth.fetch(...);
auth.state;
```

The private implementation can still be specific.

## The practical decision

Use hosted sign-in as the only place humans enter credentials.

Keep two completion paths:

```txt
Cookie:
  for Epicenter-owned web apps inside the approved cookie boundary

Bearer:
  for extensions, desktop apps, CLIs, daemons, cross-origin apps,
  third-party apps, and trusted static OAuth clients outside the cookie boundary
```

Do not make cookie apps use OAuth for symmetry. Do not make bearer apps depend on cookies for simplicity.

The product sentence is:

```txt
Every app starts sign-in the same way.
Each factory finishes sign-in in the way its runtime can safely carry a session.
```

That is the idea to protect while implementing the cleanup.
