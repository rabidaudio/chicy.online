const { until } = require('../poll')

class ApiError extends Error {
  constructor (data, opts = {}) {
    super(data.message, opts)
    this.data = data
  }
}

class Api {
  constructor (hostname, logger) {
    this.hostname = hostname
    this.headers = {
      Accept: 'application/json'
    }
    this.logger = logger
  }

  async fetch (path, opts = {}) {
    this.logger.http(`${opts.method || 'GET'} ${path}`)
    const optsHeaders = opts.headers || {}
    const args = { ...opts, headers: { ...this.headers, ...optsHeaders } }
    const res = await global.fetch(`${this.hostname}${path}`, args)
    if (res.status >= 400) {
      if (res.headers.get('content-type').match(/^application\/json/)) {
        const data = await res.json()
        throw new ApiError(data)
      } else {
        throw new Error('Unknown server error')
      }
    }
    if (res.headers.get('content-type').match(/^application\/json/)) {
      const { data } = await res.json()
      this.logger.http('response', data)
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

  async waitForSite ({ siteId }) {
    return await until(({ state }) => state !== 'deploying')
      .poll(async () => await this.getSite({ siteId }))
  }

  async updateSite ({ siteId, customDomain }) {
    const { res, data } = await this.fetch(`/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({ customDomain }),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    if (res.status === 202) {
      this.logger.warn('Nothing changed.')
    }
    return data
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
      .poll(async () => await this.getDeployment({ siteId, deploymentId }))
  }

  async promote ({ siteId, deploymentId }) {
    const { res, data } = await this.fetch(`/sites/${siteId}/deployments/${deploymentId}/promote`, {
      method: 'POST'
    })
    if (res.status === 202) {
      this.logger.warn('Nothing changed.')
    }
    return data
  }

  async deleteSite ({ siteId }) {
    await this.fetch(`/sites/${siteId}`, { method: 'DELETE' })
  }
}

module.exports = { Api, ApiError }
