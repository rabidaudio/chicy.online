require('@dotenvx/dotenvx').config()

const path = require('node:path')

const chalk = require('chalk')
const fetchVCR = require('fetch-vcr')

const logger = require('../src/logger').configure({
  level: process.env.LOG_LEVEL || 'error', pretty: true
}).getLogger()

const runTests = (...tests) => {
  const ctx = {}
  const chain = async (tests) => {
    const [test, ...rem] = tests
    if (!test) return
    await test(ctx)
      .then(() => console.log(chalk.green(test.name)))
      .catch(err => {
        console.log(ctx)
        console.error(chalk.red(test.name))
        console.error(err)
        throw err
      })
    await chain(rem)
  }

  chain(tests).catch(() => {
    console.error('Tests failed')
    process.exit(1)
  })
}

// NOTE: these tests are integration tests run against a development deploy
// (sls:stage=dev) of the actual app
class Api {
  // 'playback' | 'cache' | 'record' | 'erase'
  constructor (mode = process.env.VCR_MODE || 'cache') {
    this.host = process.env.TEST_HOST || 'https://api.dev.static-chic.online'
    this.mode = mode
    this.headers = {}
    this.index = 0
    this.fetchVCR = fetchVCR
    this.fetchVCR.configure({
      fixturePath: path.join(__dirname, '_fixtures'),
      mode
    })
  }

  async fetch (path, method, opts = {}) {
    logger.http(`[${this.index}] ${method} ${path}`)
    const url = new URL(this.host + path)
    // add a dummy query parameter to make subsequent reqs unique
    url.searchParams.append('_ridx', this.index)
    const optsHeaders = opts.headers || {}
    const args = { method, ...opts, headers: { ...this.headers, ...optsHeaders } }
    const res = await this.fetchVCR(url.toString(), args)
    this.index += 1
    if (res.headers.get('content-type').match(/^application\/json/)) {
      const json = await res.json()
      res.json = json
    }
    return res
  }

  set (header, value) {
    this.headers[header] = value
    return this
  }

  clear (header) {
    this.headers[header] = undefined
    return this
  }

  async GET (path, opts = {}) {
    return await this.fetch(path, 'GET', opts)
  }

  async POST (path, opts = {}) {
    return await this.fetch(path, 'POST', opts)
  }

  async PUT (path, opts = {}) {
    return await this.fetch(path, 'PUT', opts)
  }

  async DELETE (path, opts = {}) {
    return await this.fetch(path, 'DELETE', opts)
  }
}

module.exports = { runTests, Api }
