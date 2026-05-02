import { Hono } from 'hono'
import { PeopleNumber } from './template/Number'
import { Top } from './template/Top'
import { Main } from './template/Main'
import { History } from './template/History'
import { Menu } from './template/Menu'
import { Account } from './template/Account'
import { Call } from './template/Call'

const urlIds = new Map<string, Page>()

type Page = 'history' | 'main' | 'top' | 'number' | 'menu' | 'call' | 'account'
interface Data {
  proc: Page
  ctrl: string
  sub_ctrl: ''
  cur_lang: '1'
  message: ''
  code: ''
  'drinkbar-cnt': '0'
  'alcohol-cnt': '0'
  'ord-drkbar-cnt': '0'
  token: '6954a6a3c646a5.93625306'
}

const sampleItems = new Map([
  ['1202', { name: '辛味ﾁｷﾝ', price: 300 }],
  ['3101', { name: '小ｴﾋﾞのｻﾗﾀﾞ', price: 350 }],
  ['3201', { name: 'たまねぎのｽﾞｯﾊﾟ', price: 300 }],
  ['3215', { name: '半熟卵のﾍﾟﾍﾟﾛﾝﾁｰﾉ', price: 350 }],
  ['4307', { name: 'ﾍﾟﾝﾈｱﾗﾋﾞｱｰﾀ', price: 430 }],
  ['5201', { name: 'ﾃﾞｨｱﾎﾞﾗ風ﾊﾝﾊﾞｰｸﾞ', price: 500 }],
  ['8401', { name: 'ﾃｨﾗﾐｽｸﾗｼｺ', price: 300 }],
])

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
  })

const saizeriyaApp = new Hono()
  .get('/qr', (c) => {
    const id = crypto.randomUUID()
    urlIds.set(id, 'top')
    return c.redirect(`./?${id}`)
  })
  .all('/', async (c) => {
    const search = new URL(c.req.url).search.slice(1)
    let data: Data | undefined
    if (c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      data = Object.fromEntries(
        (await c.req.formData()).entries(),
      ) as unknown as Data
    }

    if (!urlIds.has(search)) {
      const next = data?.proc ?? 'top'
      urlIds.set(search, next)
    }
    const next = urlIds.get(search) || 'top'
    console.log(search)

    if (next === 'number') {
      return c.html(PeopleNumber())
    }
    if (next === 'top') {
      return c.html(Top())
    }
    if (next === 'main') {
      return c.html(Main())
    }
    if (next === 'menu') {
      return c.html(Menu())
    }
    if (next === 'history') {
      return c.html(History())
    }
    if (next === 'call') {
      return c.html(Call())
    }
    if (next === 'account') {
      return c.html(Account())
    }
    return c.notFound()
  })
  .post('/src/cmd/check_order.php', (c) => {
    return c.json({ result: 'OK' })
  })
  .post('/src/cmd/check_lastorder.php', (c) => {
    return c.json({ result: 'OK', lastorder: false })
  })
  .post('/src/cmd/check_midnight.php', (c) => {
    return c.json({ result: 'OK' })
  })
  .post('/src/cmd/put_alcohol.php', (c) => {
    return c.json({ result: 'OK' })
  })
  .post('/src/cmd/tbl_call.php', (c) => {
    return c.json({ result: 'OK' })
  })
  .post('/src/cmd/get_item.php', async (c) => {
    const form = await c.req.formData()
    const id = String(form.get('id') ?? '')
    const item = sampleItems.get(id)

    if (!item) {
      return json({ result: 'NG' })
    }

    return json({
      result: 'OK',
      alcohol_check: 0,
      item_data: {
        id,
        name: item.name,
        price: item.price,
        messages: ['0', '2'],
        mod_id: '',
        mod_name: '',
        mod_price: 0,
        mod_ini_cnt: 0,
        mod_guid: '',
        drk_id: '',
        drk_name: '',
        drk_price: 0,
        drk_guid: '',
        popup: '',
        notice: '',
        arc_type: 0,
        drk_type: 0,
        main_type: 0,
        state: 2,
      },
    })
  })

  .get('/src/page/js/base.js.php', async (c) => {
    const jsName = c.req.query('JS')
    if (!jsName || jsName.includes('..')) {
      return c.text('Invalid JS parameter', 400)
    }
    const filePath = `./dynamic-assets/js/${jsName.replace('.php', '')}`
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      return c.text('File not found', 404)
    }
    return c.body(file.stream())
  })
  .get('/data/:path{.+}', async (c) => {
    const path = c.req.param('path')
    if (path.includes('..')) {
      return c.text('Invalid path', 400)
    }
    const filePath = `./assets/data/${path}`
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      return c.text('File not found', 404)
    }
    return c.body(file.stream())
  })
  .get('/src/:path{.+}', async (c) => {
    const path = c.req.param('path')
    if (path.includes('..')) {
      return c.text('Invalid path', 400)
    }
    const filePath = `./assets/src/${path}`
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      const filePathNoPhp = filePath
        .replace(/\.js.php$/, '.js.php.js')
        .replace(/\.css.php$/, '.css.php.css')
      const fileNoPhp = Bun.file(filePathNoPhp)
      if (!(await fileNoPhp.exists())) {
        return c.text('File not found', 404)
      }
      return c.body(fileNoPhp.stream())
    }
    return c.body(file.stream())
  })

export default new Hono()
  .route('/saizeriya2/', saizeriyaApp)
  .route('/saizeriya3/', saizeriyaApp)
