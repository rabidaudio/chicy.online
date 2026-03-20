const { randomBytes } = require('node:crypto')

const logger = require('./logger').getLogger()

const Sites = require('./sites')
const Files = require('./files')
const { until } = require('./poll')

const cfront = require('./cfront')
const db = require('./db')
const s3 = require('./s3')
const sts = require('./sts')

// generate a unique id per deployment which is sequential in time,
// i.e. when sorted as strings later deployments are always alphabetically
// later
const generateDeploymentId = () => {
  const timestamp = Buffer.alloc(8)
  timestamp.writeBigInt64BE(BigInt(new Date().getTime()))
  const rand = randomBytes(4)
  return 'd_' + Buffer.concat([timestamp, rand]).toString('hex')
}

const sanitize = (deployment) => {
  const {
    deploymentId, siteId, message, createdAt, state, credentials, isLive, config
    // exclude: commitSha, invalidationId,
  } = deployment
  const data = { deploymentId, siteId, message, createdAt, state, isLive, config }
  if (state === 'pending') {
    data.uploadPath = Files.getDeploymentTarballPath(siteId, deploymentId)
    data.credentials = credentials
  }
  return data
}

class NotFoundError extends Error {}
class InvalidStateError extends Error {}

// create a new deployment for a site.
// Creates a new record in the deployments table, and generates
// temporary credentials for writing the tarball to S3.
// DeploymentIds are generated so that they are sequential;
// newer deployments are alphabetically after older ones.
// NOTE: this does not update the content on the site.
// For that, call promoteDeployment.
const create = async ({ site, message, config }) => {
  const { siteId } = site
  const deploymentId = generateDeploymentId()

  const credentials = await sts.getTemporaryCredentials({
    path: Files.getTarballKey(siteId, deploymentId),
    deploymentId
  })

  logger.info(`create ${siteId}/${deploymentId}`)
  const createdAt = new Date().toISOString()
  const deployment = await db.put('deployments', {
    deploymentId,
    siteId,
    message,
    state: 'pending', // 'ready', 'deployed'
    config,
    createdAt
  })
  return sanitize({ ...deployment, credentials })
}

// extract a deployment tarball posted to S3
// and load into the S3-backed git repo for the site
const process = async ({ tarballPath }) => {
  const pathParts = Files.parseDeploymentTarballPath(tarballPath)
  if (!pathParts) {
    logger.warn(`Invalid deployment tarball uploaded: ${tarballPath}`)
    await s3.delete(tarballPath)
    return
  }

  const { siteId, deploymentId } = pathParts
  let deployment = await db.get('deployments', { siteId, deploymentId })
  let site = await db.get('sites', { siteId })
  if (!deployment || !siteId || deployment.siteId !== siteId) {
    logger.warn(`Invalid deployment tarball: ${siteId} / ${deploymentId}`)
    await s3.delete(tarballPath)
    return
  }

  try {
    const commitSha = await Files.deploy({
      siteId,
      deploymentId,
      tarballPath,
      isFirst: !site.gitInitialized,
      config: deployment.config || {}
    })

    if (!site.gitInitialized) {
      site = await Sites.update({ ...site, gitInitialized: true })
    }

    deployment = await db.put('deployments', {
      ...deployment,
      state: 'ready',
      commitSha
    })

    await s3.delete(tarballPath)
    return deployment
  } catch (err) {
    deployment = await db.put('deployments', {
      ...deployment,
      state: 'failed'
    })

    throw err
  }
}

const list = async ({ site }) => {
  // TODO: pagination?
  const { siteId, currentDeployment } = site
  const deployments = await db.query('deployments', { siteId }, { asc: false, limit: 100 })
  return deployments.map(d => sanitize({ ...d, isLive: d.deploymentId === currentDeployment }))
}

const get = async ({ site, deploymentId }) => {
  const { siteId } = site
  const deployment = await db.get('deployments', { siteId, deploymentId })
  return sanitize(deployment)
}

// request a deployment be promoted asynchronously
const requestPromotion = async ({ site, deploymentId }) => {
  if (site.state === 'deploying') { throw new InvalidStateError('Site is already deploying') }

  const { siteId } = site
  const deployment = await db.get('deployments', { siteId, deploymentId })
  if (!deployment) { throw new NotFoundError(`Deployment not found: ${siteId}/${deploymentId}`) }
  if (deployment.state === 'pending') { throw new InvalidStateError(`Deployment is still pending: ${siteId}/${deploymentId}`) }

  if (site.currentDeployment === deploymentId) {
    // already deployed, just check the status and return
    return { site, deployment: sanitize(deployment) }
  }

  site = await Sites.trackDeploymentInProgress(site)

  await Files.triggerPromotion({ siteId, deploymentId })
  return { site, deployment: sanitize(deployment) }
}

const invalidate = async (site, deployment) => {
  if (!site.currentDeployment) return
  logger.info('invalidating cache')
  const invalidation = await cfront.invalidate(site.tenantId)
  deployment = await db.put('deployments', { ...deployment, state: 'deploying', invalidationId: invalidation.Id })

  logger.info('waiting for invalidation')
  await until((invalidation) => invalidation.Status !== 'InProgress')
    .poll(() => cfront.getInvalidation(site.tenantId, invalidation.Id))
    .then((invalidation) => console.info(`invalidation status: ${invalidation.Status}`))
}

// make the deployment live for the site
const promote = async ({ promoteKey }) => {
  const promoteParams = await Files.readPromoteRequest(promoteKey)
  if (!promoteParams) {
    logger.warn(`Not a promotion: ${promoteKey}`)
    return
  }
  const { siteId, deploymentId } = promoteParams

  logger.info(`Promotion requested for ${siteId} / ${deploymentId}`)

  let site = await db.get('sites', { siteId })
  let deployment = await db.get('deployments', { siteId, deploymentId })
  if (!site || !deployment) {
    logger.warn(`Unknown deployment: ${siteId}/${deploymentId}`)
    return
  }
  const hasDistro = !!site.tenantId

  try {
    const prepare = async () => {
      if (!hasDistro) {
        site = await Sites.prepareDistribution(site, deployment)
      }
    }
    // run in parallel. We can be setting up cloudformation while we deal with the files
    await Promise.all([prepare, Files.promote({ siteId, deploymentId })])

    // ...but we can't invalidate until all the files have been loaded
    if (hasDistro) {
      await invalidate(site, deployment)
    }
    deployment = await db.put('deployments', { ...deployment, state: 'deployed' })

    logger.info('updating site')
    site = await Sites.trackDeploymentComplete(site, deployment)

    return { site, deployment }
  } catch (err) {
    deployment = await db.put('deployments', { ...deployment, state: 'failed' })
    site = await Sites.trackDeploymentFailed(site, err.message)
    throw err
  }
}

module.exports = {
  NotFoundError,
  InvalidStateError,
  create,
  process,
  list,
  get,
  requestPromotion,
  promote
}
