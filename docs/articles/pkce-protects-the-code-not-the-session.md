# PKCE Protects the Code, Not the Session

Historical note: this article reflects the superseded cookie-family versus bearer-family design. The active direction: every app completes OAuth authorization code with PKCE, stores an OAuth session, loads identity through `GET /auth/me`, and uses auth-owned transports for protected resources.

PKCE is not token auth. It is protection for OAuth redirects when the app cannot safely hold a client secret.

The short version is this:

```txt
Cookie sign-in:
  browser goes to /sign-in
  server sets HttpOnly cookie
  no PKCE needed

Bearer OAuth sign-in:
  app sends user to hosted sign-in
  hosted auth redirects back with code
  app exchanges code for token
  PKCE proves the same app that started the flow is finishing it
```

That distinction matters because cookie sign-in and bearer sign-in move credentials in different ways.

## Cookie sign-in has no code in the URL

In a normal cookie flow, the app never receives a token. The browser navigates to the hosted sign-in page, the server creates a session, and the browser stores the cookie.

```txt
app
  |
  v
/sign-in
  |
  v
server sets HttpOnly cookie
  |
  v
browser returns to app
  |
  v
future requests include cookie automatically
```

There is no OAuth code in the callback URL. There is no token handoff to JavaScript. The credential lives in the browser cookie jar.

So PKCE has nothing to protect in this path.

## Bearer sign-in has a code in the URL

Bearer apps are asking the auth server for an app-owned credential. The app might be a browser extension, desktop app, CLI, daemon, or cross-origin SPA. Those runtimes cannot rely on Epicenter's first-party cookie jar.

The hosted sign-in page still collects the credentials, but the app needs a token afterward.

```txt
app creates OAuth request
  |
  v
hosted /sign-in
  |
  v
redirect_uri?code=temporary-code&state=random-state
  |
  v
app exchanges code for token
```

That temporary `code` is the sensitive handoff. It is not the final session token, but it can be exchanged for one if the exchange is not protected.

## PKCE makes a stolen code useless

Without PKCE, the code is too powerful.

```txt
attacker steals code
attacker exchanges code
attacker gets token
```

PKCE adds a secret that never goes through the browser redirect. The app creates a random verifier before it opens the browser. It sends only a derived challenge to the auth server.

```txt
app creates:
  code_verifier = secret random string

app sends:
  code_challenge = hash(code_verifier)

redirect returns:
  code

app exchanges:
  code + original code_verifier

server checks:
  hash(code_verifier) == code_challenge
```

Now a stolen code is not enough.

```txt
attacker steals code
attacker does not have verifier
token exchange fails
```

PKCE is the lock around the code-to-token exchange.

## Hosted sign-in is not the same thing as PKCE

Hosted sign-in is the front door. It is where the user proves who they are.

Cookie or bearer is how the session gets carried afterward.

```txt
Hosted sign-in:
  who are you?

Cookie:
  browser carries the session with HttpOnly cookies

Bearer:
  app carries the session with Authorization: Bearer

PKCE:
  protects the OAuth code exchange used by bearer apps
```

That is why cookie apps do not need PKCE for normal hosted sign-in. There is no code in the URL and no token handoff to JavaScript. The browser just receives a secure cookie.

Bearer apps do need PKCE because they are asking the hosted auth server to hand them an app-owned credential after a redirect.

The practical rule is simple:

```txt
Hosted sign-in is the front door.
Cookie or bearer is how the session gets carried afterward.
PKCE is only needed when that carrying method involves OAuth code exchange.
```
