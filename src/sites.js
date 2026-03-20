const dns = require('node:dns/promises')

const namor = require('namor')

const logger = require('./logger').getLogger()

const { generateDeployKey, obfuscateDeployKey } = require('./auth/deploy_keys')
const { until } = require('./poll')
const Config = require('./config')

const cfront = require('./cfront')
const db = require('./db')
const git = require('./files')
const r53 = require('./r53')
const s3 = require('./s3')

class DomainValidationFailedError extends Error {
  constructor (shortMessage, options) {
    super(shortMessage, options)
    this.code = options.code
    this.source = options.source
    this.allowed = options.allowed
    if (options.results) this.results = options.results
  }

  get fullMessage () {
    return `Domain validation failed: ${this.message}.\n` +
      `You must set a CNAME DNS record pointing your custom domain '${this.source}' to ` +
      (this.allowed.length === 1
        ? `'${this.allowed[0]}'`
        : ('one of ' + this.allowed.map(v => `'${v}'`).join(', '))) +
      ' before adding a custom domain. It may take a few minutes after ' +
      'creating the record before the change is detected.'
  }
}

// generate a unique human-friendly id for each site to be used
// as a subdomain.
const generateSiteId = () => {
  // space size: 7948^2*(26+10)^5 = 3.8 quadrillion
  // ~50% chance of collision in sqrt() -> ~62 million
  const name = namor.generate({ words: 2, salt: 5 })
  if (!namor.valid_subdomain(name, { reserved: true })) { return generateSiteId() } // try again
  return name
}

const getSiteDomain = (siteId) => `${siteId}.${process.env.SITES_DOMAIN}`

// Check if the customDomain is pointing correctly. Will throw a DomainValidationFailedError
// if not, return silently if verified
const verifyCustomDomain = async (siteId, customDomain, allowed) => {
  try {
    logger.http(`dns: resolve ${customDomain} CNAME`)
    const results = await dns.resolveCname(customDomain)
    logger.http(`dns: resolved ${customDomain} CNAME`, results)
    if (results.length === 0) {
      throw new DomainValidationFailedError('record has no value', {
        code: 'INVALID', source: customDomain, allowed
      })
    }
    for (const target of allowed) {
      if (results[0] === target) return // ok
    }
    throw new DomainValidationFailedError('record has incorrect value', {
      code: 'INVALID', source: customDomain, allowed, results
    })
  } catch (err) {
    if (err.code === 'ENOTFOUND') {
      throw new DomainValidationFailedError('domain name has no records', {
        code: 'NOT_FOUND', source: customDomain, allowed, cause: err
      })
    }
    if (err.code === 'ENODATA') {
      throw new DomainValidationFailedError('domain name has non-CNAME records', {
        code: 'NOT_FOUND', source: customDomain, allowed, cause: err
      })
    }
    throw new DomainValidationFailedError(err.message, {
      code: 'UNKNOWN', source: customDomain, allowed, cause: err
    })
  }
}

const getUserSite = async (userId, siteId) => {
  const userSites = await db.query('sites', { userId }, { idx: 'idxUserId', asc: false, limit: 100 })
  return userSites.find(s => s.siteId === siteId)
}

const list = async (userId) => {
  // TODO: pagination
  const sites = await db.query('sites', { userId }, { idx: 'idxUserId', asc: false, limit: 100 })
  return sites.map(s => sanitize(s))
}

// create a site. A site has a siteId which is
// a randomly generated subdomain like `estate-specify-07euk`,
// a deploy key used to authenticate deployments, a name,
// a userId which owns it.
const create = async ({ name, userId, customDomain }) => {
  const siteId = generateSiteId()
  const siteDomain = getSiteDomain(siteId)
  logger.info(`generating ${siteId}`)

  if (customDomain) {
    await this.verifyCustomDomain(siteId, customDomain, [
      getSiteDomain(siteId), process.env.DISTRIBUTION_DOMAIN
    ])
  }

  await r53.createSubdomain(siteDomain)
  const site = await db.put('sites', {
    siteId,
    userId,
    name,
    customDomain,
    gitInitialized: false,
    state: 'ready', // ready -> deploying -> deployed
    createdAt: new Date().toISOString(),
    ...generateDeployKey()
  })
  return sanitize(site, { showDeployKey: true })
}

const get = async (siteId) => {
  const site = await db.get('sites', { siteId })
  return sanitize(site)
}

const update = async (site) => {
  site = await db.put('sites', site)
  return sanitize(site)
}

const kvmKeys = (site) => {
  const keys = [`config/${getSiteDomain(site.siteId)}`]
  if (site.customDomain) keys.push(`config/${site.customDomain}`)
  return keys
}

const writeConfig = async (site, config) => {
  // add the config to kvs
  let { headers, rewriteRules } = Config.sanitize(config || {})
  headers ||= {}
  rewriteRules ||= []
  await cfront.writeConfig(kvmKeys(site), { headers, rewriteRules })
}

// add/remove custom domain
// state: no_change, pending_set, pending_deploy, cleared
const setCustomDomain = async (site, newCustomDomain) => {
  const { siteId, tenantId, etag } = site
  const baseDomain = getSiteDomain(siteId)
  const removingDomain = !newCustomDomain
  const customDomainPending = site.customDomain && !site.domainAttached

  const response = (state) => ({ site: sanitize(site), state })

  if (removingDomain && !site.customDomain) {
    // no change, still no domain
    return response('no_change')
  }

  if (newCustomDomain === site.customDomain && customDomainPending) {
    // if setting it to the same as the pending value, we're still waiting on it
    return response(tenantId ? 'pending_set' : 'pending_deploy')
  } else if (newCustomDomain === site.customDomain) {
    return response('no_change')
  }

  if (!tenantId) {
    // if the distro hasn't been created yet, just save the values and move on
    site = await db.put('sites', { ...site, customDomain: newCustomDomain, domainAttached: false })
    return response(removingDomain ? 'cleared' : 'pending_deploy')
  }

  if (site.currentDeploymentId) {
    // if there's an active deployment, we need to update kvs to support the new domain
    if (removingDomain) {
      await cfront.deleteConfig([`config/${site.customDomain}`])
    } else {
      const { config } = await db.get('deployments', { siteId, deploymentId: site.currentDeploymentId })
      await writeConfig(site, config)
    }
  }

  if (removingDomain) {
    const res = await cfront.removeCustomDomain({ tenantId, etag, baseDomain })
    site = await db.put('sites', { ...site, etag: res.etag, customDomain: null, domainAttached: false })
    return response('cleared')
  } else {
    const res = await cfront.setCustomDomain({ tenantId, etag, baseDomain, customDomain: newCustomDomain })
    site = await db.put('sites', { ...site, etag: res.etag, customDomain: newCustomDomain, domainAttached: false })

    // try attaching once to see if the cert is already available
    try {
      const attachRes = await attachDomain(site)
      site = attachRes.site
      if (attachRes.state === 'attached') return response('attached')
    } catch (err) {
      // if it fails it's probably because it hasn't validated yet.
      logger.warn(`attachment failed: ${err.message}`)
    }
    return response('pending_set')
  }
}

// CloudFront will automatically request and validate a certificate but it won't automatically
// attach it to the tenant. This method gets polled by the frontend to check if the certificate
// is validated and attach it when it is. Returns one of 'no_custom_domain', 'pending_validation',
// 'attached', 'not_found', 'no_distribution'
const attachDomain = async (site) => {
  const response = (state) => {
    logger.verbose(`attachDomain ${site.siteId} state=${state}`)
    return { site: sanitize(site), state }
  }

  if (!site.customDomain) return response('no_custom_domain')
  if (!site.tenantId) return response('no_distribution')
  if (site.domainAttached) return response('attached')

  let res = await cfront.findCloudfrontCertificateMatching(site.customDomain)
  if (!res) return response('not_found')
  const { certificateArn, isIssued } = res
  if (!isIssued) return response('pending_validation')

  logger.info(`attaching certificate to ${site.siteId}: ${certificateArn}`)
  res = await cfront.attachCertificate({ tenantId: site.tenantId, etag: site.etag, certificateArn })
  site = await db.put('sites', { ...site, domainAttached: true, etag: res.etag })
  logger.info(`certificate attached to ${site.siteId}: ${certificateArn}`)
  return response('attached')
}

const prepareDistribution = async (site) => {
  if (site.tenantId) return site

  // create the distribution
  logger.info('creating distro tenant')
  const { siteId, customDomain, domainAttached } = site
  const baseDomain = getSiteDomain(siteId)
  const { tenant, etag } = await cfront.createTenant({ siteId, customDomain, baseDomain })
  logger.verbose('tenant distro created', tenant)
  site = await db.put('sites', { ...site, tenantId: tenant.Id, etag })

  if (customDomain && !domainAttached) {
    // wait for the certificate and attach it
    logger.info('awaiting certificate attachment')
    until(({ state }) => state === 'attached')
      .poll({ interval: 3000, timeout: 5 * 60 * 1000 }, async () => await attachDomain(site))
  }
  return site
}

const waitForDistribution = async (site, opts = {}) => {
  // NOTE: we don't actually need to wait for the distribution to complete to complete promotion
  logger.info('waiting for distribution')
  await until(({ tenant }) => tenant.Status !== 'InProgress')
    .poll(opts, () => cfront.getTenant(site.tenantId))
    .then(({ tenant }) => console.info(`distribution status: ${tenant.Status}`))
}

const trackDeploymentInProgress = async (site) => {
  site = await db.put('sites', {
    ...site,
    state: 'deploying'
  })
  return sanitize(site)
}

const trackDeploymentComplete = async (site, deployment) => {
  await writeConfig(site, deployment.config)

  return await db.put('sites', {
    ...site,
    currentDeploymentId: deployment.deploymentId,
    deployedAt: new Date().toISOString(),
    state: 'deployed'
  })
}

const trackDeploymentFailed = async (site, reason) => {
  return await db.put('sites', {
    ...site,
    state: 'failed',
    reason
  })
}

const regenerateDeployKey = async (site) => {
  site = await db.put('sites', {
    ...site,
    ...generateDeployKey()
  })
  return sanitize(site, { showDeployKey: true })
}

const deleteSite = async (siteId) => {
  logger.warn(`deleting site ${siteId}`)
  const site = await db.get('sites', { siteId })
  const { tenantId, etag } = site

  // delete resources
  if (tenantId) {
    // disable first
    const res = await cfront.disableTenant({ tenantId, etag })
    logger.info(`[${siteId}] disabled distribution tenant`)
    await cfront.deleteTenant({ tenantId, etag: res.etag })
    logger.info(`[${siteId}] deleted distribution tenant`)
  }

  await r53.deleteSubdomain(getSiteDomain(siteId))
  logger.info(`[${siteId}] deleted subdomain route`)

  // delete data from S3
  await s3.deleteRecursive(git.getSiteContentKey(siteId))
  logger.info(`[${siteId}] deleted site content`)
  await s3.deleteRecursive(git.getSiteDeploymentsKey(siteId))
  logger.info(`[${siteId}] deleted deployment data`)

  // delete all deployments from db
  for (const { deploymentId } in await db.scan('deployments', { siteId })) {
    logger.info(`deleting ${siteId}/${deploymentId}`)
    await db.delete('deployments', { siteId, deploymentId })
  }
  logger.info(`[${siteId}] deleted deployment history`)

  await cfront.deleteConfig(kvmKeys(site))

  // TODO: delete all unattached certificates matching domain

  // delete site from db
  await db.delete('sites', { siteId })
  logger.info(`[${siteId}] deleted site`)
  logger.info(`site deleted: ${siteId}`)
}

// explicitly allow parameters to be returned
const sanitize = (site, { showDeployKey } = {}) => {
  const {
    siteId, name, customDomain, domainAttached, userId,
    currentDeploymentId, deployedAt, createdAt, state,
    deployKey, deployKeyCreatedAt, deployKeyLastUsedAt,
    tenantId
    // excluding: etag, gitInitialized
  } = site
  return {
    siteId,
    name,
    // show the site as having a custom domain if it's been attached
    // or there is no tenant yet
    customDomain: customDomain && (!tenantId || domainAttached) ? customDomain : null,
    baseDomain: getSiteDomain(siteId),
    userId,
    currentDeploymentId,
    deployedAt,
    createdAt,
    state,
    deployKeyCreatedAt,
    deployKeyLastUsedAt,
    deployKey: (showDeployKey ? deployKey : obfuscateDeployKey(deployKey))
  }
}

module.exports = {
  DomainValidationFailedError,
  verifyCustomDomain,
  getUserSite,
  list,
  create,
  get,
  update,
  setCustomDomain,
  attachDomain,
  prepareDistribution,
  waitForDistribution,
  trackDeploymentInProgress,
  trackDeploymentComplete,
  trackDeploymentFailed,
  regenerateDeployKey,
  delete: deleteSite
}
