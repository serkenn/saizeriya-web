# saizeriya.js

> [!WARNING]
> This package is for research and interoperability testing. It is an unofficial client for studying Saizeriya's mobile ordering flow, and it should not be used to disrupt, overload, bypass, or otherwise misuse any real service.

`saizeriya.js` provides a TypeScript client and a small interactive CLI for Saizeriya's mobile ordering pages.

## Install

```bash
npm i saizeriya.js
```

## CLI

Run the CLI directly with npm or Bun:

```bash
npx saizeriya.js help
bunx saizeriya.js help
```

Start a named session from a QR URL:

```bash
npx saizeriya.js start lunch "https://example.com/saizeriya3/qr" --people 2
```

The CLI stores session snapshots in `~/.saizeriya-cli/sessions.json` by default. Set `SAIZERIYA_CLI_HOME` to use another directory.

Top-level commands:

```text
saizeriya start <name> <qrurl> [--people <count>]
saizeriya use <name>
saizeriya list
saizeriya rm <name>
```

Inside a session, type `help` to see available commands. Common commands include:

```text
state
people <count>
lookup <code>
add <code> [count] [--mod-id <id>] [--mod-count <count>] [--reorder]
cart
remove <index>
submit
account
receipt
call [staff|dessert]
exit
```

## Library

```ts
import { createClient } from 'saizeriya.js'

const client = await createClient({
  qrURLSource: 'https://example.com/saizeriya3/qr',
  peopleCount: 2,
})

await client.addItem('1202')
console.log(client.getState().cart)
```

For tests or research fixtures, pass a custom `fetchSource`:

```ts
const client = await createClient({
  qrURLSource,
  fetchSource: (request) => fetch(request),
})
```

## Development

```bash
bun install
bun --cwd packages/client pack
bun run test
```
