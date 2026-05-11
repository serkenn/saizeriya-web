#!/usr/bin/env node
import {
  createClient,
  type AccountSummary,
  type ClientState,
  type LookupItemResult,
} from './src/client'
import menuData from '../server/src/data/menu.json'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

type OfficialClient = Awaited<ReturnType<typeof createClient>>
type BrowserOfficialClient = Awaited<
  ReturnType<typeof import('./src/browser-mode').createBrowserClient>
>
type AnyOfficialClient = OfficialClient | BrowserOfficialClient
type CookieEntry = [string, string]
type FetchSource = (request: Request) => Promise<Response> | Response
type ClientMode = 'fetch' | 'browser'

interface StaticMenuItem {
  id: string
  name: string
  price: number
  state: number
  mod_id?: string
  mod_name?: string
}

interface StaticMenuEntry {
  result: string
  item_data?: StaticMenuItem
}

interface SessionSnapshot {
  name: string
  state: ClientState
  cookies: CookieEntry[]
  mode?: ClientMode
  qrURLSource?: string
  createdAt: number
  updatedAt: number
}

const cliHome = process.env.SAIZERIYA_CLI_HOME ?? join(homedir(), '.saizeriya-cli')
const sessionsPath = join(cliHome, 'sessions.json')
const officialGetItemURL = 'https://ioes.saizeriya.co.jp/saizeriya2/src/cmd/get_item.php'

const usage = `Usage:
  saizeriya start <name> <qrurl> [--people <count>] [--browser] [--headless]
  saizeriya use <name>
  saizeriya list
  saizeriya rm <name>
  saizeriya menu [query|code] [--shop <id> --table <id>] [--json]

After start/use, available commands:
  state
  people <count>
  lookup <code>
  add <code> [count] [--mod-id <id>] [--mod-count <count>] [--reorder]
  cart
  cart-page
  remove <index>
  submit
  account
  receipt
  call [staff|dessert]
  menu
  history
  reorder <code>
  alcohol
  check <order|last|midnight>
  help
  exit`

const readSessions = async (): Promise<Record<string, SessionSnapshot>> => {
  try {
    return JSON.parse(await readFile(sessionsPath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

const writeSessions = async (sessions: Record<string, SessionSnapshot>) => {
  await mkdir(dirname(sessionsPath), { recursive: true })
  await writeFile(sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`)
}

const saveSession = async (
  name: string,
  client: AnyOfficialClient,
  cookies: CookieEntry[],
  mode: ClientMode = 'fetch',
  qrURLSource?: string,
  createdAt = Date.now(),
) => {
  const sessions = await readSessions()
  sessions[name] = {
    name,
    state: client.getState(),
    cookies,
    mode,
    qrURLSource,
    createdAt,
    updatedAt: Date.now(),
  }
  await writeSessions(sessions)
}

const cookieHeader = (cookies: Map<string, string>) =>
  [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

const storeSetCookie = (cookies: Map<string, string>, response: Response) => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    return
  }

  for (const cookie of setCookie.split(/,(?=\s*[^;,\s]+=)/)) {
    const [pair] = cookie.split(';')
    const separator = pair?.indexOf('=') ?? -1
    if (pair && separator > 0) {
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
}

const createCookieFetch = (initialCookies: CookieEntry[] = []) => {
  const cookies = new Map<string, string>(initialCookies)

  const fetchSource: FetchSource = async (request) => {
    const headers = new Headers(request.headers)
    const currentCookies = cookieHeader(cookies)
    if (currentCookies) {
      headers.set('cookie', currentCookies)
    }

    const response = await fetch(new Request(request, { headers }))
    storeSetCookie(cookies, response)
    return response
  }

  return {
    fetchSource,
    getCookies: () => [...cookies.entries()] as CookieEntry[],
  }
}

const parseNumberOption = (args: string[], name: string) => {
  const index = args.indexOf(name)
  if (index === -1) {
    return undefined
  }
  const value = args[index + 1]
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} requires an integer value`)
  }
  return parsed
}

const hasFlag = (args: string[], name: string) => args.includes(name)

const getOptionValue = (args: string[], name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const stripCliOptions = (args: string[]) => {
  const stripped: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === undefined) {
      continue
    }
    if (arg === '--browser' || arg === '--headless') {
      continue
    }
    stripped.push(arg)
    if (arg === '--people' || arg === '--mod-id' || arg === '--mod-count') {
      const value = args[index + 1]
      if (value !== undefined) {
        stripped.push(value)
        index++
      }
    }
  }
  return stripped
}

const useBrowserMode = (args: string[]) => hasFlag(args, '--browser') || process.env.BROWSER === '1'

const browserInstallHint = [
  'Browser mode requires Playwright to be installed in the same execution environment.',
  'With npm/npx, run:',
  '  npm exec --package saizeriya.js --package playwright -- saizeriya start <name> <qrurl> --browser',
  'With bunx, optional dependencies are normally installed with the package; if your environment omits them, run from a project that has playwright installed.',
].join('\n')

const loadBrowserClient = async () => {
  try {
    return await import('./src/browser-mode')
  } catch (error) {
    throw new Error(browserInstallHint, { cause: error })
  }
}

const tokenize = (line: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined

  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(current)
  }
  return tokens
}

const printState = (state: ClientState) => {
  console.log(
    [
      `shop=${state.shopId}`,
      `table=${state.tableNo}`,
      `people=${state.peopleCount}`,
      `page=${state.pageKind}`,
      `cart=${state.cart.length}`,
    ].join(' '),
  )
}

const printLookupItem = (result: LookupItemResult) => {
  if (result.result !== 'OK' || !result.item_data) {
    console.log(result)
    return
  }

  const item = result.item_data
  const availability = item.state === 0 ? 'sold out' : 'available'
  console.log(`${item.id} ${item.name} ${item.price}yen ${availability}`)
  if (item.mod_id) {
    console.log(`modifier: ${item.mod_id} ${item.mod_name}`)
  }
  for (const message of item.messages) {
    console.log(message)
  }
}

const staticMenuItems = (menuData as StaticMenuEntry[])
  .map((entry) => entry.item_data)
  .filter((item): item is StaticMenuItem => Boolean(item))

const normalizeSearchText = (value: string) => value.normalize('NFKC').toLowerCase()

const stripMenuOptions = (args: string[]) => {
  const stripped: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === undefined) {
      continue
    }
    if (arg === '--json') {
      continue
    }
    if (arg === '--shop' || arg === '--table') {
      index++
      continue
    }
    stripped.push(arg)
  }
  return stripped
}

const printStaticMenuItem = (item: StaticMenuItem) => {
  const availability = item.state === 0 ? 'sold out' : 'available'
  console.log(`${item.id} ${item.name} ${item.price}yen ${availability}`)
  if (item.mod_id && item.mod_name) {
    console.log(`  modifier: ${item.mod_id} ${item.mod_name}`)
  }
}

const showStaticMenu = (args: string[]) => {
  const json = hasFlag(args, '--json')
  const query = stripMenuOptions(args).join(' ').trim()
  const normalizedQuery = normalizeSearchText(query)
  const items = normalizedQuery
    ? staticMenuItems.filter((item) => {
        return (
          item.id.includes(query) ||
          normalizeSearchText(item.name).includes(normalizedQuery) ||
          normalizeSearchText(item.mod_name ?? '').includes(normalizedQuery)
        )
      })
    : staticMenuItems

  if (json) {
    console.log(JSON.stringify(items, null, 2))
    return
  }

  if (items.length === 0) {
    console.log('No menu items found.')
    return
  }

  for (const item of items) {
    printStaticMenuItem(item)
  }
}

const lookupOfficialMenuItem = async (args: string[]) => {
  const json = hasFlag(args, '--json')
  const shopId = getOptionValue(args, '--shop')
  const tableNo = getOptionValue(args, '--table')
  const code = stripMenuOptions(args).join(' ').trim()

  if (!shopId) {
    throw new Error('--shop is required when using --table')
  }
  if (!tableNo) {
    throw new Error('--table is required when using --shop')
  }
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Official menu lookup requires a 4 digit item code')
  }

  const response = await fetch(officialGetItemURL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: 'https://ioes.saizeriya.co.jp',
      referer: 'https://ioes.saizeriya.co.jp/saizeriya2/',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      sid: shopId.replace(/^0+/, ''),
      tno: tableNo,
      lng: '1',
      id: code,
      num: '3',
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch menu item: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as LookupItemResult
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printLookupItem(result)
  }
}

const showMenu = async (args: string[]) => {
  const hasShop = hasFlag(args, '--shop')
  const hasTable = hasFlag(args, '--table')
  if (hasShop || hasTable) {
    await lookupOfficialMenuItem(args)
    return
  }

  showStaticMenu(args)
}

const printCart = (state: ClientState) => {
  if (state.cart.length === 0) {
    console.log('Cart is empty.')
    return
  }

  state.cart.forEach((item, index) => {
    const price = item.price === undefined ? '' : ` ${item.price}yen`
    console.log(`${index + 1}. ${item.id} x${item.count} ${item.name ?? ''}${price}`)
  })
}

const printAccount = (account: AccountSummary) => {
  if (account.lines.length === 0) {
    console.log('No account lines.')
  }

  for (const line of account.lines) {
    console.log(`${line.name} x${line.count} ${line.price}yen`)
  }
  console.log(`total: ${account.total}yen (${account.count} items)`)
  if (account.controlNo) {
    console.log(`control: ${account.controlNo}`)
  }
}

const requireArg = (args: string[], index: number, name: string) => {
  const value = args[index]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const runCommand = async (
  client: AnyOfficialClient,
  args: string[],
): Promise<'continue' | 'exit'> => {
  const command = args[0]

  switch (command) {
    case undefined:
      return 'continue'
    case 'help':
      console.log(usage)
      return 'continue'
    case 'exit':
    case 'quit':
      return 'exit'
    case 'state':
      printState(client.getState())
      return 'continue'
    case 'people': {
      const count = Number(requireArg(args, 1, 'count'))
      printState(await client.setPeopleCount(count))
      return 'continue'
    }
    case 'lookup':
      printLookupItem(await client.lookupItem(requireArg(args, 1, 'code')))
      return 'continue'
    case 'add': {
      const code = requireArg(args, 1, 'code')
      const count = args[2]?.startsWith('--') ? undefined : Number(args[2] ?? 1)
      const modIdIndex = args.indexOf('--mod-id')
      const modCount = parseNumberOption(args, '--mod-count')
      printState(
        await client.addItem(code, {
          count,
          modId: modIdIndex === -1 ? undefined : args[modIdIndex + 1],
          modCount,
          reorder: args.includes('--reorder'),
        }),
      )
      return 'continue'
    }
    case 'cart':
      printCart(client.getState())
      return 'continue'
    case 'cart-page':
      printState(await client.goToCart())
      return 'continue'
    case 'remove': {
      const index = Number(requireArg(args, 1, 'index')) - 1
      printState(await client.removeCartItem(index))
      return 'continue'
    }
    case 'submit':
      printState(await client.submitOrder())
      return 'continue'
    case 'account': {
      const result = await client.getAccount()
      printAccount(result.account)
      return 'continue'
    }
    case 'receipt': {
      const result = await client.getReceipt()
      printAccount(result.account)
      return 'continue'
    }
    case 'call': {
      const target = args[1] ?? 'staff'
      const result = target === 'dessert' ? await client.callDessert() : await client.callStaff()
      console.log(result)
      return 'continue'
    }
    case 'menu':
      printState(await client.goToMenu())
      return 'continue'
    case 'history':
      printState(await client.goToHistory())
      return 'continue'
    case 'reorder':
      printState(await client.reorder(requireArg(args, 1, 'code')))
      return 'continue'
    case 'alcohol':
      if (!('confirmAlcohol' in client)) {
        throw new Error('The alcohol command is only available in fetch mode.')
      }
      console.log(await client.confirmAlcohol())
      return 'continue'
    case 'check': {
      if (
        !('checkOrderStarted' in client) ||
        !('checkLastOrder' in client) ||
        !('checkMidnight' in client)
      ) {
        throw new Error('The check command is only available in fetch mode.')
      }
      const target = requireArg(args, 1, 'target')
      if (target === 'order') {
        console.log(await client.checkOrderStarted())
      } else if (target === 'last') {
        console.log(await client.checkLastOrder())
      } else if (target === 'midnight') {
        console.log(await client.checkMidnight())
      } else {
        throw new Error('target must be order, last, or midnight')
      }
      return 'continue'
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

const runRepl = async (
  name: string,
  client: AnyOfficialClient,
  getCookies: () => CookieEntry[],
  mode: ClientMode,
  qrURLSource: string | undefined,
  createdAt: number,
) => {
  const rl = createInterface({ input, output })
  console.log(`Session "${name}" is ready. Type help for commands.`)

  try {
    while (true) {
      const line = await rl.question(`saizeriya:${name}> `)
      try {
        const result = await runCommand(client, tokenize(line))
        await saveSession(name, client, getCookies(), mode, qrURLSource, createdAt)
        if (result === 'exit') {
          break
        }
      } catch (error) {
        console.error((error as Error).message)
      }
    }
  } finally {
    rl.close()
    if ('close' in client) {
      await client.close()
    }
  }
}

const startSession = async (args: string[]) => {
  const mode: ClientMode = useBrowserMode(args) ? 'browser' : 'fetch'
  const strippedArgs = stripCliOptions(args)
  const name = requireArg(strippedArgs, 0, 'name')
  const qrURLSource = requireArg(strippedArgs, 1, 'qrurl')
  const peopleCount = parseNumberOption(args, '--people')
  const headless = hasFlag(args, '--headless')
  const cookieFetch = createCookieFetch()
  const client =
    mode === 'browser'
      ? await (
          await loadBrowserClient()
        ).createBrowserClient({
          qrURLSource,
          peopleCount,
          launchOptions: headless ? { headless: true } : undefined,
        })
      : await createClient({
          qrURLSource,
          fetchSource: cookieFetch.fetchSource,
          peopleCount,
        })
  const createdAt = Date.now()
  await saveSession(
    name,
    client,
    mode === 'browser' ? [] : cookieFetch.getCookies(),
    mode,
    qrURLSource,
    createdAt,
  )
  printState(client.getState())
  await runRepl(
    name,
    client,
    mode === 'browser' ? () => [] : cookieFetch.getCookies,
    mode,
    qrURLSource,
    createdAt,
  )
}

const useSession = async (args: string[]) => {
  const name = requireArg(args, 0, 'name')
  const sessions = await readSessions()
  const snapshot = sessions[name]
  if (!snapshot) {
    throw new Error(`Session not found: ${name}`)
  }

  const mode = snapshot.mode ?? 'fetch'
  const cookieFetch = createCookieFetch(snapshot.cookies)
  const client =
    mode === 'browser'
      ? await (async () => {
          if (!snapshot.qrURLSource) {
            throw new Error(
              'Browser sessions require the original QR URL. Start a new browser session.',
            )
          }
          return await (
            await loadBrowserClient()
          ).createBrowserClient({
            qrURLSource: snapshot.qrURLSource,
            peopleCount: snapshot.state.peopleCount > 0 ? snapshot.state.peopleCount : undefined,
          })
        })()
      : await createClient({
          initialState: snapshot.state,
          fetchSource: cookieFetch.fetchSource,
        })
  printState(client.getState())
  await runRepl(
    name,
    client,
    mode === 'browser' ? () => [] : cookieFetch.getCookies,
    mode,
    snapshot.qrURLSource,
    snapshot.createdAt,
  )
}

const listSessions = async () => {
  const sessions = await readSessions()
  for (const session of Object.values(sessions)) {
    const updated = new Date(session.updatedAt).toISOString()
    console.log(
      `${session.name}\t${updated}\t${session.mode ?? 'fetch'}\ttable=${session.state.tableNo}`,
    )
  }
}

const removeSession = async (args: string[]) => {
  const name = requireArg(args, 0, 'name')
  const sessions = await readSessions()
  delete sessions[name]
  await writeSessions(sessions)
  console.log(`Removed ${name}`)
}

const main = async () => {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'start':
      await startSession(args)
      break
    case 'use':
      await useSession(args)
      break
    case 'list':
      await listSessions()
      break
    case 'rm':
      await removeSession(args)
      break
    case 'menu':
      await showMenu(args)
      break
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(usage)
      break
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
