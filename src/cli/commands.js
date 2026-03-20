const { stat } = require('node:fs/promises')
const path = require('node:path')

const chalk = require('chalk')
const prettyBytes = require('pretty-bytes').default
const prompts = require('@inquirer/prompts')
const ora = require('ora').default

const logger = require('../logger').getLogger()

const { ApiError } = require('./api')
const { getDb } = require('./local_storage')
const { isInteractive, getSiteDomain, relativeTime, showTable } = require('./utils')
const { saveCommonConfig } = require('../config')
const { verifyCustomDomain, DomainValidationFailedError } = require('../sites')
const Files = require('../files')
const s3 = require('../s3')

async function init (argv) {
  const { name } = argv
  if (isInteractive) console.log(chalk.blue('Creating new site'))
  const { siteId, deployKey } = await argv.api.createSite({ name })

  if (argv.generateConfig) {
    const configPath = await saveCommonConfig()
    if (configPath) {
      console.log(chalk.yellow('Created a config file at ') + chalk.dim(configPath) +
        chalk.yellow(' with some sensible defaults. Use this to configure the deployment settings of your site.'))
    } else if (isInteractive) {
      console.log(chalk.yellow('Skipped creating a config file as one already exists.'))
    }
  }

  if (isInteractive) {
    console.log(chalk.green('Site created: ') + chalk.bold(getSiteDomain(siteId)))
    console.warn(chalk.gray("This deploy key can be used to deploy your site from a CI server. Be sure to save it, we'll only show it once."))
    console.log(chalk.bold('Deploy key: ') + deployKey)
  } else {
    console.log(`SC_SITE_ID=${siteId} SC_DEPLOY_KEY=${deployKey}`)
  }
  process.exit(0)
}

async function showSites (argv) {
  const sites = await argv.api.getSites()
  const colorizeState = (state) => {
    switch (state) {
      case 'ready': return chalk.magenta(state)
      case 'deploying': return chalk.yellow(state)
      case 'deployed': return chalk.green(state)
      case 'failed': return chalk.red(state)
      default: return chalk.dim(state)
    }
  }
  showTable(sites.map(({
    name, siteId, customDomain, state, currentDeployment, createdAt, deployedAt
  }) => ({
    name: chalk.black(name),
    siteId: chalk.bold(siteId),
    state: colorizeState(state),
    domain: chalk.underline(customDomain || getSiteDomain(siteId)),
    deployment: currentDeployment,
    created: isInteractive ? relativeTime(createdAt) : createdAt,
    published: isInteractive ? relativeTime(deployedAt) : deployedAt
  })))
  process.exit(0)
}

async function configure (argv) {
  if (isInteractive) {
    if (argv.domain) {
      console.log(chalk.blue('Setting custom domain ') + chalk.bold(argv.domain) +
        chalk.blue(' for site ') + chalk.bold(argv.site))
    } else {
      console.log(chalk.blue('Removing custom domain from ') + chalk.bold(argv.site))
    }
  }

  // TODO: client doesn't know what cloudfront domain to allow
  // if (argv.domain) {
  //   try {
  //     logger.verbose(`verifying domain ${argv.domain}`)
  //     await verifyCustomDomain(argv.site, argv.domain)
  //   } catch (err) {
  //     if (err instanceof DomainValidationFailedError) {
  //       // logger.verbose('validation failed', err)
  //       console.error(chalk.red(err.fullMessage))
  //       process.exit(20)
  //     }
  //     throw err
  //   }
  // }

  const { siteId, customDomain } = await argv.api.updateSite({ siteId: argv.site, customDomain: argv.domain })
  if (isInteractive) {
    if (customDomain) {
      console.log(chalk.green('Your site is now available at ') + chalk.underline(customDomain))
    } else {
      console.log(chalk.green('Custom domain removed. ') +
        'You can still access your site at ' + chalk.underline(getSiteDomain(siteId)))
    }
  } else {
    console.log(argv.site)
  }
  process.exit(0)
}

async function regenerateKey (argv) {
  if (isInteractive) {
    console.log(chalk.blue('Regenerating deploy key for ') + chalk.bold(argv.site))
    const { deployKey, deployKeyLastUsedAt } = argv.siteData
    const doIt = prompts.confirm({
      message: chalk.red('This will revoke deploy key ') + chalk.bold(deployKey) + (
        deployKeyLastUsedAt
          ? chalk.red(' last used ') + chalk.bold(relativeTime(deployKeyLastUsedAt))
          : chalk.dim('(never used)')
      ) + chalk.red('. ') + 'Are you sure you want to continue?'
    })
    if (!doIt) {
      console.log(chalk.yellow('Aborted.'))
      process.exit(10)
    }
  }
  const { siteId, deployKey } = await argv.api.regenerateKey({ siteId: argv.site })
  if (isInteractive) {
    console.log(chalk.green('Deploy key regenerated for ') + chalk.bold(getSiteDomain(siteId)))
    console.warn(chalk.gray("This deploy key can be used to deploy your site from a CI server. Be sure to save it, we'll only show it once."))
    console.log(chalk.bold('Deploy key: ') + deployKey)
  } else {
    console.log(`SC_SITE_ID=${siteId} SC_DEPLOY_KEY=${deployKey}`)
  }
  process.exit(0)
}

async function showDeployments (argv) {
  const deployments = await argv.api.getDeployments({ siteId: argv.site })
  if (deployments.length === 0) {
    console.warn(chalk.yellow('No deployments for site ') + chalk.dim(argv.site) + chalk.yellow('.'))
    process.exit(0)
  }
  const colorizeState = (state) => {
    switch (state) {
      case 'ready': return chalk.magenta(state)
      case 'pending': return chalk.yellow(state)
      case 'deployed': return chalk.blue(state)
      case 'failed': return chalk.red(state)
      default: return chalk.dim(state)
    }
  }
  showTable(deployments.map(({
    deploymentId, message, createdAt, state, isLive
  }) => ({
    deploymentId: chalk.bold(deploymentId),
    state: isLive ? chalk.bold(chalk.green('live')) : colorizeState(state),
    message,
    created: isInteractive ? relativeTime(createdAt) : createdAt
  })))
  process.exit(0)
}

async function deploy (argv) {
  const { message, exclude, dryRun, config } = argv
  if (isInteractive) console.log(chalk.blue('Deploying to site ') + chalk.bold(argv.site))
  argv.spinner ||= ora()

  const allExcludes = [...exclude, ...(config.exclude)]
  if (dryRun) {
    const files = await Files.allFilesRelative(argv.path, { exclude: allExcludes })
    let size = 0
    for (const file of files) {
      const s = await stat(path.join(argv.path, file))
      console.log(file)
      size += s.size
    }
    console.log('Total size: ' + chalk.bold(prettyBytes(size)))
    process.exit(0)
  }

  argv.spinner.text = 'Creating...'
  argv.spinner.start()
  const {
    deploymentId, siteId, uploadPath, credentials
  } = await argv.api.deploy({ siteId: argv.site, message, config })
  argv.spinner.text = 'Uploading...'
  const tarball = await Files.createTarball(argv.path, { exclude: allExcludes })
  await s3.upload(uploadPath, tarball, {
    credentials,
    progress: ({ loaded }) => { argv.spinner.text = `Uploading... ${prettyBytes(loaded)}` }
  })

  if (argv.wait) {
    argv.spinner.text = 'Waiting...'
    await argv.api.waitForDeployment({ siteId, deploymentId })
  }

  if (argv.promote) {
    argv.deployment = deploymentId
    await promote(argv)
  } else {
    if (isInteractive) {
      argv.spinner.succeed(chalk.green('Deployment Created: ') + chalk.bold(deploymentId))
    } else {
      argv.spinner.stop()
      console.log(deploymentId)
    }
  }
  process.exit(0)
}

async function promote (argv) {
  argv.spinner ||= ora()
  if (isInteractive) console.log(chalk.blue('Promoting deployment ') + chalk.bold(argv.deployment))
  argv.spinner.text = 'Promoting...'
  const { siteId, customDomain } = await argv.api.promote({ siteId: argv.site, deploymentId: argv.deployment })

  if (argv.wait) {
    argv.spinner.text = 'Waiting...'
    await argv.api.waitForSite({ siteId: argv.site })
  }

  if (isInteractive) {
    argv.spinner.succeed(
      chalk.green('Deployment ') + chalk.bold(argv.deployment) + chalk.green(' is now live at ') +
        chalk.underline(customDomain || getSiteDomain(siteId))
    )
    if (!argv.wait) {
      console.log('It may take a few minutes for the CDN to invalidate. You may also have to clear your browser cache.')
    }
  } else {
    argv.spinner.stop()
    console.log(argv.deployment)
  }
  process.exit(0)
}

async function removeSite (argv) {
  if (isInteractive) {
    console.log(chalk.blue('Deleting site ') + chalk.bold(argv.site))
    const siteId = await prompts.input({
      message: chalk.red('This will permanently remove the site ') + chalk.bold(argv.site) + chalk.red(' and all data. ') +
        'Enter the siteId to confirm.'
    })
    if (siteId !== argv.site) {
      console.log(chalk.yellow('Aborted.'))
      process.exit(10)
    }
  }
  await argv.api.deleteSite({ siteId: argv.site })
  if (isInteractive) console.log(chalk.green('Site Removed.'))
}

const authenticateUser = async (argv, next) => {
  logger.verbose('check for token in local storage')
  const db = await getDb()
  if (db.data.userToken) {
    logger.verbose('verify token')
    argv.api.authenticateUserToken(db.data.userToken)
    const { isLoggedIn, res } = await argv.api.status()
    if (isLoggedIn) {
      // store refreshed user tokens
      if (res.headers.get('new-authorization')) {
        const token = res.headers.get('new-authorization').replace(/^Basic /, '')
        argv.api.authenticateUserToken(token)
        await db.update((data) => { data.userToken = token })
      }
      return await next()
    } else {
      await db.update((data) => { data.userToken = null }) // clear token
    }
  }

  if (isInteractive) {
    // go through login flow
    const { authReqId, authorizationUrl } = await argv.api.signup('github')
    console.log('Authenticate using your GitHub account.')
    console.log(chalk.bold('Open this url in your browser: ') + chalk.underline(authorizationUrl))

    const { state, userToken } = await argv.api.checkSignup({ authReqId })
    if (state === 'authorized') {
      logger.verbose('saving token')
      await db.update((data) => { data.userToken = userToken }) // save token
      argv.api.authenticateUserToken(userToken)
      return await next()
    } else {
      // TODO: more helpful error
      console.warn('Unable to authenticate')
      process.exit(1)
    }
  }

  // TODO: more helpful error
  console.warn('An authentication token or deploy key is required.')
  process.exit(1)
}

const authenticateDeployKeyOrUser = async (argv, next) => {
  if (argv.deployKey) {
    argv.api.authenticateDeployKey(argv.deployKey)
    const { isLoggedIn, data } = await argv.api.status()
    if (!isLoggedIn) {
      console.error('Deploy key has expired or been revoked. Please check your key or request a new one with `regenerate`.')
      process.exit(1)
    }
    argv.site ||= data.deployKeySiteId
    return await next()
  }
  return await authenticateUser(argv, next)
}

const resolveSite = async (argv, next) => {
  if (argv.site) {
    try {
      argv.siteData = await argv.api.getSite({ siteId: argv.site })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        console.error(chalk.red('Unable to find site ') + chalk.bold(argv.site) +
          chalk.red(' in your account.'))
        process.exit(1)
      }
      throw err
    }
  }
  return await next()
}

module.exports = {
  init,
  showSites,
  configure,
  regenerateKey,
  showDeployments,
  deploy,
  promote,
  removeSite,
  authenticateUser,
  authenticateDeployKeyOrUser,
  resolveSite
}
