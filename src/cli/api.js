const { duration } = require('moment')

const { until } = require('../poll')

const logger = require('../logger').getLogger()

class ApiError extends Error {
  constructor (res, data, opts = {}) {
    super(data.message, opts)
    this.status = res.status
    this.data = data
  }
}

class Api {
  constructor (hostname) {
    this.hostname = hostname
    this.headers = {
      Accept: 'application/json'
    }
  }

  async fetch (path, opts = {}) {
    logger.http(`${opts.method || 'GET'} ${path}`)
    const optsHeaders = opts.headers || {}
    const args = { ...opts, headers: { ...this.headers, ...optsHeaders } }
    const res = await global.fetch(`${this.hostname}${path}`, args)
    if (res.status >= 400) {
      if (res.headers.get('content-type').match(/^application\/json/)) {
        const data = await res.json()
        throw new ApiError(res, data)
      } else {
        throw new Error('Unknown server error')
      }
    }
    if (res.headers.get('content-type').match(/^application\/json/)) {
      const { data } = await res.json()
      logger.http('response', data)
      return { res, data }
    }
    return { res }
  }

  authenticateUserToken (token) {
    this.headers.Authorization = `Basic ${token}`
  }

  authenticateDeployKey (key) {
    this.headers.Authorization = `Bearer ${key}`
  }

  async status () {
    const { data, res } = await this.fetch('/')
    const isLoggedIn = !!(data.userId || data.deployKeySiteId)
    return { isLoggedIn, data, res }
  }

  async signup ({ provider } = {}) {
    provider ||= 'github'
    const { data } = await this.fetch('/signup', { method: 'POST', query: { provider } })
    // const { authReqId, expiresAt, state, authorizationUrl } = data
    return data
  }

  async checkSignup ({ authReqId }) {
    // { authReqId, expiresAt, state, userToken, authorizationUrl }
    const { data } = await until(({ data }) => data.state !== 'pending').poll(async () => {
      return await this.fetch(`/signup/${authReqId}`, { method: 'GET' })
    })
    return data
  }

  async createSite ({ name }) {
    const { data } = await this.fetch('/sites', {
      method: 'POST',
      body: JSON.stringify({ name }),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    return data
  }

  async getSite ({ siteId }) {
    const { data } = await this.fetch(`/sites/${siteId}`)
    return data
  }

  async getSites () {
    const { data } = await this.fetch('/sites')
    return data
  }

  async waitForPromotion ({ siteId }) {
    return await until(({ state }) => state !== 'deploying')
      .poll({
        interval: duration(15, 's'),
        timeout: duration(10, 'm')
      }, async () => await this.getSite({ siteId }))
  }

  async updateSite ({ siteId, customDomain }) {
    const { data } = await this.fetch(`/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({ customDomain }),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    return data
  }

  async attachDomain ({ siteId }) {
    const { res, data } = await this.fetch(`/sites/${siteId}/attachDomain`, { method: 'POST' })
    if (res.status === 202) return null // still waiting for attachment
    return data // otherwise done, return site
  }

  async waitForDomain ({ siteId }) {
    return await until((site) => site)
      .poll({ timeout: duration(3, 'm') }, async () => await this.attachDomain({ siteId }))
  }

  async regenerateKey ({ siteId }) {
    const { data } = await this.fetch(`/sites/${siteId}/deployKey/regenerate`, { method: 'POST' })
    return data
  }

  async deploy ({ siteId, message, config }) {
    const { data } = await this.fetch(`/sites/${siteId}/deployments`, {
      method: 'POST',
      body: JSON.stringify({ message, config }),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    return data
  }

  async getDeployment ({ siteId, deploymentId }) {
    const { data } = await this.fetch(`/sites/${siteId}/deployments/${deploymentId}`)
    return data
  }

  async getDeployments ({ siteId }) {
    const { data } = await this.fetch(`/sites/${siteId}/deployments`)
    return data
  }

  async waitForDeployment ({ siteId, deploymentId }) {
    return await until(({ state }) => state !== 'pending')
      .poll({
        interval: duration(15, 's'),
        timeout: duration(10, 'm')
      }, async () => await this.getDeployment({ siteId, deploymentId }))
  }

  async promote ({ siteId, deploymentId }) {
    const { res, data } = await this.fetch(`/sites/${siteId}/deployments/${deploymentId}/promote`, {
      method: 'POST'
    })
    if (res.status === 202) {
      logger.warn('Nothing changed.')
    }
    return data
  }

  async deleteSite ({ siteId }) {
    await this.fetch(`/sites/${siteId}`, { method: 'DELETE' })
  }
}

module.exports = { Api, ApiError }
