# Derived Types Are a Map, Not a Model

`ReturnType`, `Parameters`, `Extract`, and indexed access types are great when they point back to the real owner. They are a smell when they become the way we design the model. If every useful type is carved out of one large upstream shape, the type system is telling us the ownership is upside down.

This is the kind of code that starts the conversation:

```typescript
type VerifyOAuthAccessToken = ReturnType<
	ReturnType<typeof oauthProviderResourceClient>['getActions']
>['verifyAccessToken'];
```

That type is not wrong. Better Auth owns `oauthProviderResourceClient()`, `getActions()`, and `verifyAccessToken`. We are not copying Better Auth's function signature into our codebase; we are following the owner.

But it does read like spelunking.

```txt
oauthProviderResourceClient()
  -> getActions()
  -> verifyAccessToken
```

The type is a map back to Better Auth. That is a reasonable use of `ReturnType`. The risk is when this style becomes how we create our own domain types too.

## ReturnType Is Best When The Runtime Value Owns The Shape

Factory returns are one of the strongest cases for derived types.

```typescript
export function createAuthStateStore(initialState: AuthState) {
	let state = initialState;
	const listeners = new Set<(state: AuthState) => void>();

	return {
		get state() {
			return state;
		},
		setState(next: AuthState) {
			state = next;
			for (const listener of listeners) listener(next);
		},
		onStateChange(fn: (state: AuthState) => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}

export type AuthStateStore = ReturnType<typeof createAuthStateStore>;
```

The factory is the implementation and the returned object is the public handle. `ReturnType` keeps one source of truth.

The bad version says the same thing twice:

```typescript
export type AuthStateStore = {
	state: AuthState;
	setState(next: AuthState): void;
	onStateChange(fn: (state: AuthState) => void): () => void;
};

export function createAuthStateStore(initialState: AuthState): AuthStateStore {
	// same shape repeated here
}
```

Now the type can drift from the factory. It looks explicit, but it is really duplication.

## Extract Is The Tell When You Own The Union

`Extract` often appears after a union got too wide too early.

```typescript
type MachineAuthTransportError =
	| RequestFailed
	| DeviceCodeExpired
	| DeviceAccessDenied
	| DeviceAuthorizationFailed;

type RequestDeviceCodeError = Extract<
	MachineAuthTransportError,
	{ name: 'RequestFailed' }
>;
```

That says: "I made one big type, but this function only uses a slice of it."

The bottom-up version starts from the pieces that actually exist:

```typescript
type MachineAuthRequestError = RequestFailed;

type DeviceTokenError =
	| DeviceCodeExpired
	| DeviceAccessDenied
	| DeviceAuthorizationFailed;
```

Then each function returns the errors it can actually produce.

```typescript
async function requestDeviceCode(): Promise<
	Result<DeviceCodeResponse, MachineAuthRequestError>
> {
	// can only fail because the request failed
}

async function pollDeviceToken(): Promise<
	Result<DevicePollOutcome, MachineAuthRequestError | DeviceTokenError>
> {
	// can fail at the request layer or the OAuth response layer
}
```

No filtering. No patch. The union appears where the two fault domains meet.

```txt
request layer error
  + oauth token error
  = pollDeviceToken error
```

That is the difference between top-down and bottom-up composition.

## Union And Intersection Are Not Automatically Better

`|` and `&` are just operators. They are not morally superior to `ReturnType`.

This is still top-down:

```typescript
type AppError =
	| RequestFailed
	| DeviceCodeExpired
	| DeviceAccessDenied
	| DeviceAuthorizationFailed
	| StorageUnavailable;

type SignOutError = Extract<AppError, { name: 'RequestFailed' }>;
```

The smell is not the syntax. The smell is that `AppError` was declared before the smaller concepts earned their names.

This is bottom-up:

```typescript
type HttpRequestError = RequestFailed;
type OAuthDeviceError = DeviceCodeExpired | DeviceAccessDenied;
type SessionStorageError = StorageUnavailable;

type LoginError = HttpRequestError | OAuthDeviceError | SessionStorageError;
```

The pieces have owners. The aggregate is just the place where they meet.

`&` has the same rule.

```typescript
type WorkspaceIdentity = {
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};

type BearerWorkspaceIdentity = WorkspaceIdentity & {
	authorization: string;
};
```

That works if a bearer workspace identity really is a workspace identity plus an authorization token. It is fake if the intersection only exists because two callers happened to share fields.

## The OAuth Resolver Type Is Probably Acceptable, But It Is Not Free

Back to the original type:

```typescript
type VerifyOAuthAccessToken = ReturnType<
	ReturnType<typeof oauthProviderResourceClient>['getActions']
>['verifyAccessToken'];
```

I would not call this a serious code smell. The owner is external, and deriving the function type avoids copying a Better Auth contract.

I would call it a readability smell if it spreads. The next reader has to mentally execute two factory calls inside a type expression.

One gentler version is to name the intermediate concept:

```typescript
type OAuthResourceActions = ReturnType<
	ReturnType<typeof oauthProviderResourceClient>['getActions']
>;

type VerifyOAuthAccessToken = OAuthResourceActions['verifyAccessToken'];
```

That is still derived, but now the type expression has a landmark.

Another version tries to name the capability in local language:

```typescript
type VerifyOAuthAccessToken = (
	accessToken: string,
	options: Parameters<
		ReturnType<
			ReturnType<typeof oauthProviderResourceClient>['getActions']
		>['verifyAccessToken']
	>[1],
) => ReturnType<
	ReturnType<
		ReturnType<typeof oauthProviderResourceClient>['getActions']
	>['verifyAccessToken']
>;
```

That is worse. It pretends to be clearer while repeating the derived path in three places.

The tempting local-language version moves the Better Auth shape into a pure
resolver dependency:

```typescript
type AppAccessTokenDeps = {
	authorization: string | null;
	verifyAppAccessToken(accessToken: string): Promise<unknown>;
	findUserById(userId: string): Promise<User | null>;
};
```

That can be right, but it was wrong in this app access token case. The Hono
request already owns `Authorization`, `authBaseURL`, and `db`; drilling those
through a dependency object made production code harder to read so the tests
could call a context-free helper. The cleaner version inlines the Hono adapter
and verifies the request directly:

```typescript
export async function resolveRequestAppAccessTokenUser(c: Context<RequestOAuthEnv>) {
	const accessToken = parseBearer(c.req.header('authorization') ?? null);
	if (!accessToken) return OAuthError.InvalidToken();

	const audience = c.var.authBaseURL;
	const payload = await verifyOAuthAccessToken(accessToken, {
		verifyOptions: {
			audience,
			issuer: createOAuthIssuerURL(audience),
		},
		jwksUrl: createOAuthJwksURL(audience),
	}).catch(() => null);

	// scope check, user lookup, projection
}
```

The rule is not "always inject". Inject when the caller has a real alternate
runtime to provide. Inline when the dependency object just re-packages values
already owned by the current layer.

So the problem is not "ReturnType exists." The problem is whether the derived type is shortening the path to the owner or hiding the fact that we never named the owner.

## The Review Question Is Ownership

Use derived types when the owner is somewhere else:

```txt
External library owns it? Derive or import it.
Runtime schema owns it? Infer it.
Factory owns it? ReturnType it.
Constant owns it? typeof it.
Function owns it? Parameters or ReturnType it.
Your domain owns it? Name the domain type directly.
```

Avoid derived types when they are compensating for a type that was too broad:

```typescript
type LocalThing = Extract<BigThingWeOwn, { kind: 'small' }>;
type LocalMethod = Pick<LargeServiceWeOwn, 'oneMethod'>;
type LocalOptions = Parameters<typeof hugeFunction>[0]['tinySlice'];
```

Those can be valid, but they deserve suspicion. They often mean the small concept should have existed first.

The rule I like:

```txt
Derived type = map to an owner.
Union or intersection = composition of owned pieces.

If there is no clear owner, stop typing and find the concept.
```

Existing notes that cover nearby ground:

- [Derive Types Before You Declare Them](./derive-types-before-you-declare-them.md)
- [Extract<> Is the Tell That You Composed Top-Down](./20260504T100000-extract-is-the-tell-you-composed-top-down.md)
- [Copied Types Are Boundary Leaks](./copied-types-are-boundary-leaks.md)
- [When Two Types Feel Wrong, Find the Owner](./20260503T120000-when-two-types-feel-wrong-find-the-owner.md)
- [Factory Return Types Should Point Back To The Factory](./factory-return-types-should-point-back-to-the-factory.md)
- [Shared Contract Over Derived Types](./shared-contract-over-derived-types.md)
