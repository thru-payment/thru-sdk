# Authentication

## API keys (server-to-server)

The SDK authenticates with a workspace **API key**, sent as the `x-api-key` header on
every request. Create one in the dashboard under **Developers → API keys**. The raw key
is shown only once; store it in a secret manager.

```ts
const thru = new Thru({ apiKey: process.env.THRU_API_KEY });
```

An API key acts as the workspace `owner`, so it passes every role check. Each key is
scoped to exactly one workspace.

> Keep API keys on the server. Anyone with the key can move money. Never ship it to a
> browser or mobile app. For client-side checkout, use [`@thru/react`](./react.md),
> which only calls public read-only endpoints.

### Managing keys programmatically

```ts
const created = await thru.apiKeys.create({ name: 'CI deploy key' });
console.log(created.key); // shown once

await thru.apiKeys.list();
await thru.apiKeys.revoke(created.id);
```

## Dashboard sessions

Some endpoints (creating an organization workspace, switching the active workspace,
accepting an invitation) are tied to a **logged-in user**, not an API key, because an API
key is bound to a single workspace. Those calls require a browser session cookie and are
generally made by your own dashboard, not a server integration. The SDK exposes them for
completeness (`thru.workspaces.create`, `thru.workspaces.switch`, ...), but they will
return `403` when called with an API key.

## Base URL

The default base URL is `https://api.thru.la/v1`. Override it for staging or a
self-hosted deployment:

```ts
const thru = new Thru({ apiKey, baseUrl: 'https://api.staging.thru.la/v1' });
```
