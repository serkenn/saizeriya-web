#!/usr/bin/env node
import {
  createClient,
  type AccountSummary,
  type ClientState,
  type LookupItemResult,
} from './src/client'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

type OfficialClient = Awaited<ReturnType<typeof createClient>>
type CookieEntry = [string, string]
type FetchSource = (request: Request) => Promise<Response> | Response

interface SessionSnapshot {
  name: string
  state: ClientState
  cookies: CookieEntry[]
  createdAt: number
  updatedAt: number
}

const cliHome = process.env.SAIZERIYA_CLI_HOME ?? join(homedir(), '.saizeriya-cli')
const sessionsPath = join(cliHome, 'sessions.json')

const usage = `Usage:
  saizeriya start <name> <qrurl> [--people <count>]
  saizeriya use <name>
  saizeriya list
  saizeriya rm <name>

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
  client: OfficialClient,
  cookies: CookieEntry[],
  createdAt = Date.now(),
) => {
  const sessions = await readSessions()
  sessions[name] = {
    name,
    state: client.getState(),
    cookies,
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

const runCommand = async (client: OfficialClient, args: string[]): Promise<'continue' | 'exit'> => {
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
      console.log(await client.confirmAlcohol())
      return 'continue'
    case 'check': {
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
  client: OfficialClient,
  getCookies: () => CookieEntry[],
  createdAt: number,
) => {
  const rl = createInterface({ input, output })
  console.log(`Session "${name}" is ready. Type help for commands.`)

  try {
    while (true) {
      const line = await rl.question(`saizeriya:${name}> `)
      try {
        const result = await runCommand(client, tokenize(line))
        await saveSession(name, client, getCookies(), createdAt)
        if (result === 'exit') {
          break
        }
      } catch (error) {
        console.error((error as Error).message)
      }
    }
  } finally {
    rl.close()
  }
}

const startSession = async (args: string[]) => {
  const name = requireArg(args, 0, 'name')
  const qrURLSource = requireArg(args, 1, 'qrurl')
  const peopleCount = parseNumberOption(args, '--people')
  const cookieFetch = createCookieFetch()
  const client = await createClient({
    qrURLSource,
    fetchSource: cookieFetch.fetchSource,
    peopleCount,
  })
  const createdAt = Date.now()
  await saveSession(name, client, cookieFetch.getCookies(), createdAt)
  printState(client.getState())
  await runRepl(name, client, cookieFetch.getCookies, createdAt)
}

const useSession = async (args: string[]) => {
  const name = requireArg(args, 0, 'name')
  const sessions = await readSessions()
  const snapshot = sessions[name]
  if (!snapshot) {
    throw new Error(`Session not found: ${name}`)
  }

  const cookieFetch = createCookieFetch(snapshot.cookies)
  const client = await createClient({
    initialState: snapshot.state,
    fetchSource: cookieFetch.fetchSource,
  })
  printState(client.getState())
  await runRepl(name, client, cookieFetch.getCookies, snapshot.createdAt)
}

const listSessions = async () => {
  const sessions = await readSessions()
  for (const session of Object.values(sessions)) {
    const updated = new Date(session.updatedAt).toISOString()
    console.log(`${session.name}\t${updated}\ttable=${session.state.tableNo}`)
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
