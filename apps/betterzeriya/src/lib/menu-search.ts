export type SearchableMenuItem = {
  code: string
  name: string
  kana: string
  category?: string
  tags?: string[]
}

const whitespacePattern = /\s+/gu
const numericPattern = /^\d+$/u

export const normalizeMenuSearchText = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(whitespacePattern, '')

const getSearchTokens = (query: string) =>
  query
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .split(whitespacePattern)
    .map((token) => token.trim())
    .filter(Boolean)

const fuzzyDistanceLimit = (queryLength: number) => {
  if (queryLength <= 2) {
    return 0
  }
  if (queryLength <= 4) {
    return 1
  }
  if (queryLength <= 8) {
    return 2
  }
  return 3
}

const includesInOrder = (query: string, text: string) => {
  let queryIndex = 0
  for (const character of text) {
    if (character === query[queryIndex]) {
      queryIndex += 1
      if (queryIndex === query.length) {
        return true
      }
    }
  }
  return false
}

const getEditDistance = (a: string, b: string, maxDistance: number) => {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
    const current = [aIndex]
    let rowMin = current[0]

    for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
      const cost = a[aIndex - 1] === b[bIndex - 1] ? 0 : 1
      const distance = Math.min(
        previous[bIndex] + 1,
        current[bIndex - 1] + 1,
        previous[bIndex - 1] + cost,
      )
      current[bIndex] = distance
      rowMin = Math.min(rowMin, distance)
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1
    }
    previous = current
  }

  return previous[b.length]
}

const hasNearSubstring = (query: string, text: string) => {
  const maxDistance = fuzzyDistanceLimit(query.length)
  if (maxDistance === 0) {
    return false
  }

  const shortestWindow = Math.max(1, query.length - maxDistance)
  const longestWindow = Math.min(text.length, query.length + maxDistance)

  for (let windowLength = shortestWindow; windowLength <= longestWindow; windowLength += 1) {
    for (let start = 0; start <= text.length - windowLength; start += 1) {
      const candidate = text.slice(start, start + windowLength)
      if (getEditDistance(query, candidate, maxDistance) <= maxDistance) {
        return true
      }
    }
  }

  return false
}

const tokenMatchesText = (token: string, text: string) => {
  if (!token || !text) {
    return false
  }
  if (text.includes(token)) {
    return true
  }
  if (token.length >= 3 && includesInOrder(token, text)) {
    return true
  }
  return hasNearSubstring(token, text)
}

export const matchesMenuSearch = (item: SearchableMenuItem, query: string) => {
  const tokens = getSearchTokens(query)
  if (!tokens.length) {
    return true
  }

  const code = normalizeMenuSearchText(item.code)
  const textFields = [item.name, item.kana, item.category ?? '', ...(item.tags ?? [])].map(
    (value) => normalizeMenuSearchText(value),
  )

  return tokens.every((token) => {
    const normalizedToken = normalizeMenuSearchText(token)
    if (numericPattern.test(normalizedToken)) {
      return code.includes(normalizedToken)
    }
    return (
      code.includes(normalizedToken) ||
      textFields.some((field) => tokenMatchesText(normalizedToken, field))
    )
  })
}
