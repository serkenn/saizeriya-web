import { type HTMLElement, parse } from 'node-html-parser'

export type PageKind =
  | 'top'
  | 'number'
  | 'menu'
  | 'main'
  | 'history'
  | 'call'
  | 'account'
  | 'receipt'
  | 'unknown'

export class PageParser {
  readonly root: HTMLElement
  constructor(html: string) {
    this.root = parse(html)
  }

  getOptionalInputValue(selector: string): string | undefined {
    return this.root.querySelector(selector)?.getAttribute('value')
  }

  getInputValue(selector: string, label: string): string {
    const value = this.getOptionalInputValue(selector)
    if (value === undefined) {
      throw new Error(`${label} value not found`)
    }
    return value
  }

  getShopId(): number {
    return Number.parseInt(
      this.getInputValue('input[id="shop-id"]', 'Shop ID'),
      10,
    )
  }

  getTableNo(): number {
    return Number.parseInt(
      this.getInputValue('input[id="table-no"]', 'Table number'),
      10,
    )
  }

  getToken(): string | undefined {
    return this.getOptionalInputValue('input[name="token"]')
  }

  getSessionId(): string | undefined {
    return this.getOptionalInputValue('input[id="session-id"]')
  }

  getPeopleCount(): number | undefined {
    const value = this.getOptionalInputValue('input[id="number"]')
    return value ? Number.parseInt(value, 10) : undefined
  }

  getPageKind(): PageKind {
    const pageClass = this.root
      .querySelector('form[id="frm_ctrl"]')
      ?.getAttribute('class')
      ?.split(/\s+/)
      .find((className) => className.endsWith('-page'))

    if (!pageClass) {
      return 'unknown'
    }

    const kind = pageClass.replace(/-page$/, '')
    if (
      kind === 'top' ||
      kind === 'number' ||
      kind === 'menu' ||
      kind === 'main' ||
      kind === 'history' ||
      kind === 'call' ||
      kind === 'account' ||
      kind === 'receipt'
    ) {
      return kind
    }
    return 'unknown'
  }

  getNextActionId(): string {
    const form = this.root.querySelector('form[id="frm_ctrl"]')
    if (!form) {
      throw new Error('Form with id "frm_ctrl" not found')
    }
    const action = form.getAttribute('action')
    if (!action) {
      throw new Error('Form action attribute not found')
    }
    const id = action.split('?')[1]
    if (!id) {
      throw new Error('No action id found in form action')
    }
    return id
  }
}
