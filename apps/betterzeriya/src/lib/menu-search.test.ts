import { describe, expect, it } from 'vite-plus/test'
import { matchesMenuSearch, normalizeMenuSearchText } from './menu-search'

const menuItem = {
  code: '1202',
  name: '小ｴﾋﾞのｻﾗﾀﾞ',
  kana: 'ｺｴﾋﾞﾉｻﾗﾀﾞ',
  category: 'サラダ',
  tags: ['海老'],
}

describe('menu search', () => {
  it('normalizes half-width and full-width characters', () => {
    expect(normalizeMenuSearchText(' ＡＢＣ１２３ ｺｴﾋﾞ ')).toBe('abc123コエビ')
    expect(matchesMenuSearch(menuItem, '小エビ')).toBe(true)
    expect(matchesMenuSearch(menuItem, 'ｺｴﾋﾞ')).toBe(true)
  })

  it('matches menu code without fuzzy numeric false positives', () => {
    expect(matchesMenuSearch(menuItem, '120')).toBe(true)
    expect(matchesMenuSearch(menuItem, '1203')).toBe(false)
  })

  it('matches small typos with fuzzy search', () => {
    expect(matchesMenuSearch(menuItem, '小エビのサタダ')).toBe(true)
    expect(matchesMenuSearch(menuItem, '小エビサラ')).toBe(true)
  })

  it('requires every search token to match', () => {
    expect(matchesMenuSearch(menuItem, '小エビ サラダ')).toBe(true)
    expect(matchesMenuSearch(menuItem, '小エビ ドリア')).toBe(false)
  })
})
