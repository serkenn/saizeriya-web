import type { FetchSource } from './utils/fetch'
import type { PageKind } from './utils/page-parser'

export interface ClientInit {
  qrURLSource: string
  fetchSource?: FetchSource
  peopleCount: number
}

export interface ItemData {
  id: string
  name: string
  price: number
  messages: string[]
  mod_id: string
  mod_name: string
  mod_price: number
  mod_ini_cnt: number
  mod_guid: string
  drk_id: string
  drk_name: string
  drk_price: number
  drk_guid: string
  popup: string
  notice: string
  arc_type: number
  drk_type: number
  main_type: number
  state: number
}

export interface LookupItemResult {
  result: string
  item_data?: ItemData
  alcohol_check?: number
}

export interface CartItem {
  id: string
  name?: string
  price?: number
  count: number
  reorder: 0 | 1
  modId: string
  modCount: number | ''
}

export interface AddItemOptions {
  count?: number
  modId?: string
  modCount?: number
  reorder?: boolean
}

export interface CallOptions {
  after?: boolean
}

export interface ClientState {
  baseURL: string
  nextId: string
  shopId: number
  tableNo: number
  peopleCount: number
  token?: string
  sessionId?: string
  pageKind: PageKind
  cart: CartItem[]
}

export type PageSubmitFields = Record<string, string | number | undefined>
