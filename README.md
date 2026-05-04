# saizeriya

This repository includes a saizeriya-compatible server, client library, and client app.

## Setup

```bash
bun i
```

## Compatible Server

```bash
cd packages/server
bun dev
```

You can see the dashboard at `/dashboard`.

## Client Library

A saizeriya client library written in JS/TS.

```bash
bun add saizeriya.js
```

And this includes CLI.

```bash
bunx saizeriya.js
# or
bun add -g saizeriya.js
saizeriya --help
```

## Agent Skills

```bash
bunx skills add pnsk-lab/saizeriya/skills
```

With agent skills, you can order dishes with AI Agents such as Claude Code and Codex.

## Betterzeriya: Client App

Betterzeriya is a 3rd-party client for saizeriya, with better UX and performance.

```bash
cd apps/betterzeriya
bun dev
```

## Star History

<a href="https://www.star-history.com/?repos=pnsk-lab%2Fsaizeriya&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=pnsk-lab/saizeriya&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=pnsk-lab/saizeriya&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=pnsk-lab/saizeriya&type=date&legend=top-left" />
 </picture>
</a>
