import { describe, expect, it } from 'bun:test'
import mockServer from '@repo/saizeriya-server'
import { createClient } from './client'

describe('createClient', () => {
  it('Should create a client', async () => {
    const client = await createClient({
      qrURLSource: 'http://example.com/saizeriya3/qr',
      fetchSource: mockServer.fetch,
      peopleCount: 4,
    })
    expect(client.getState().peopleCount).toBe(4)
    expect(client.getState().pageKind).toBe('menu')
    await expect(client.call()).resolves.toEqual({ result: 'OK' })
  })

  it('looks up and adds items sequentially', async () => {
    const client = await createClient({
      qrURLSource: 'http://example.com/saizeriya3/qr',
      fetchSource: mockServer.fetch,
      peopleCount: 3,
    })

    await Promise.all([
      client.addItem('1202', { count: 2 }),
      client.addItem('3201'),
    ])

    expect(client.getState().cart).toMatchObject([
      { id: '1202', count: 2, name: '辛味ﾁｷﾝ' },
      { id: '3201', count: 1, name: 'たまねぎのｽﾞｯﾊﾟ' },
    ])
    expect(client.getState().pageKind).toBe('main')

    await expect(client.lookupItem('3215')).resolves.toMatchObject({
      result: 'OK',
      item_data: { id: '3215', name: '半熟卵のﾍﾟﾍﾟﾛﾝﾁｰﾉ' },
    })
  })
})
