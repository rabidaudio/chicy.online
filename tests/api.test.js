require('@dotenvx/dotenvx').config()

const path = require('node:path')

const { expect } = require('chai')
const chalk = require('chalk')
const prompts = require('@inquirer/prompts')
const fetchVCR = require('fetch-vcr')

require('../src/logger').configure({
  level: process.env.LOG_LEVEL || 'error', pretty: true
})

const { createTarball } = require('../src/files')

const runTests = (...tests) => {
  const ctx = {}
  const chain = async (tests) => {
    const [test, ...rem] = tests
    if (!test) return
    return test(ctx)
      .then(() => console.log(chalk.green(test.name)))
      .catch(err => {
        console.log(ctx)
        console.error(chalk.red(test.name))
        console.error(err)
        throw err
      })
      .then(chain(rem))
  }

  chain(tests)
}



// NOTE: these tests are integration tests run against a development deploy
// (sls:stage=dev) of the actual app
class Api {
   // 'playback' | 'cache' | 'record' | 'erase'
  constructor(mode = process.env.VCR_MODE || 'cache') {
    this.host = process.env.TEST_HOST || 'https://dev.static-chic.online'
    this.mode = mode
    this.headers = {}
    this.index = 0
    this.fetchVCR = fetchVCR
    this.fetchVCR.configure({
      fixturePath: path.join(__dirname, '_fixtures'),
      mode
    })
  }

  async fetch(path, method, opts = {}) {
    const url = new URL(this.host + path)
    // add a dummy query parameter to make subsequent reqs unique
    url.searchParams.append('_ridx', this.index)
    const res = await this.fetchVCR(url.toString(), { method, headers: this.headers, ...opts })
    this.index += 1
    if (res.headers.get('content-type').match(/^application\/json/)) {
      const json = await res.json()
      res.json = json
    }
    return res
  }

  set(header, value) {
    this.headers[header] = value
    return this
  }

  clear(header) {
    this.headers[header] = undefined
    return this
  }
  
  async GET(path, opts = {}) {
    return await this.fetch(path, 'GET', opts)
  }

  async POST(path, opts = {}) {
    return await this.fetch(path, 'POST', opts)
  }

  async PUT(path, opts = {}) {
    return await this.fetch(path, 'PUT', opts)
  }
  
  async DELETE(path, opts = {}) {
    return await this.fetch(path, 'DELETE', opts)
  }
}
const api = new Api()

async function testRunning(ctx) {
  const res = await api.GET('/')
  expect(res.status).to.equal(200)
  expect(res.json.status).to.equal('OK')
  expect(res.json.data.app).to.exist
  expect(res.json.data.distro).to.match(/.+\.cloudfront\.net/)
}

async function testAuth(ctx) {
  let res = await api.POST(`/signup?provider=github`)
  expect(res.status).to.equal(200)
  expect(res.json.status).to.equal('OK')
  expect(res.json.data.authReqId).to.exist
  expect(res.json.data.authorizationUrl).to.match(/^https:\/\/github.com\/login\/oauth\/authorize/)
  ctx.authReqId = res.json.data.authReqId

  res = await api.GET(`/signup/${ctx.authReqId}`)
  expect(res.status).to.equal(200)
  expect(res.json.status).to.equal('OK')
  expect(res.json.data.authReqId).to.equal(ctx.authReqId)
  expect(res.json.data.state).to.equal('pending')
  
  if (!res.wasCached) {
    console.log(chalk.bold("open ")+res.json.data.authorizationUrl)
    await prompts.confirm({ message: "authorized?" })
  }

  res = await api.GET(`/signup/${ctx.authReqId}`)
  expect(res.status).to.equal(200)
  expect(res.json.status).to.equal('OK')
  expect(res.json.data.authReqId).to.equal(ctx.authReqId)
  expect(res.json.data.state).to.equal('authorized')
  expect(res.json.data.userToken).to.exist
  ctx.userToken = res.json.data.userToken

  api.set('Authorization', `Basic ${ctx.userToken}`)
  res = await api.GET('/')
  expect(res.status).to.equal(200)
  expect(res.json.data.userId).to.match(/github_[0-9]+/)
  ctx.userId = res.json.data.userId
}

// TODO test failed auth paths

runTests(testRunning, testAuth)

// const userId = 'test'
// let siteId = 'teeny-angle-dwas5'
// let deploymentId = ''

// describe('API', () => {
//   before(async () => {
//     await createUser({ userId, name: 'Test User' })
//     if (siteId === '') {
//       const site = await createSite({ userId, name: 'Test Site' })
//       siteId = site.siteId
//     }
//   })

//   describe('Deployments', () => {
//     describe('create', () => {
//       it('should create a new deployment', async () => {
//         const testTarball = await createTarball(path.join(__dirname, '..', 'example-dist'))
//         const data = await buffer(testTarball)
//         const res = await fetch(`${api}/sites/${siteId}/deployments`, {
//           method: 'POST',
//           body: data,
//           headers: {
//             'Content-Type': 'application/gzip'
//           }
//         })
//         expect(res.status).to.equal(200)
//         const body = await res.json()
//         expect(body.status).to.equal('OK')
//         const deployment = body.data
//         expect(deployment.siteId).to.equal(siteId)
//         expect(deployment.deploymentId).not.to.equal(null)
//       })
//     })

//     describe('list', () => {
//       it('should return a list of deployments', async () => {
//         const res = await fetch(`${api}/sites/${siteId}/deployments`)
//         expect(res.status).to.equal(200)
//         const body = await res.json()
//         expect(body.status).to.equal('OK')
//         const deployments = body.data
//         expect(deployments.length).to.equal(body.pagination.count)
//         expect(deployments[0].deploymentId).to.match(/^[0-9a-f]{24}$/)
//         expect(deployments[0].siteId).to.equal(siteId)
//         deploymentId = deployments[0].deploymentId
//       })
//     })

//     describe('promote', () => {
//       it('should make the deployment live for the site', async () => {
//         const res = await fetch(`${api}/sites/${siteId}/deployments/${deploymentId}/promote`, {
//           method: 'POST'
//         })
//         expect(res.status).to.equal(200)
//         const body = await res.json()
//         expect(body.status).to.equal('OK')
//         expect(body.data.siteId).to.equal(siteId)
//         expect(body.data.currentDeployment).to.equal(deploymentId)
//       })
//     })
//   })
// })
