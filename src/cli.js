const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const prompts = require('@inquirer/prompts')
const chalk = require('chalk')
const moment = require('moment')

const isInteractive = require('is-interactive').default()

const { getDb } = require('./local_storage')

const API_HOST = 'https://api.dev.static-chic.online'
const SITE_DOMAIN = 'sites.dev.static-chic.online'

let logger

const getSiteDomain = (siteId) => `${siteId}.${SITE_DOMAIN}`

const until = (checkFn, { interval } = {}) => {
  interval ||= 5000
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  return {
    poll: async (loopFn) => {
      while (true) {
        const res = await loopFn()
        if (await checkFn(res)) {
          return res
        }
        await delay(interval)
      }
    }
  }
}

class ApiError extends Error {
  constructor (data, opts = {}) {
    super(data.message, opts)
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
        throw new ApiError(data)
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
    const { data } = await this.fetch('/')
    return !!data.userId
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
      logger.warn('Nothing changed.')
    }
    return data
  }

  async deploy ({ siteId, message }) {
    const { data } = await this.fetch(`/sites/${siteId}/deployments`, {
      method: 'POST',
      body: JSON.stringify({ message }),
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
      logger.warn('Nothing changed.')
    }
    return data
  }
}

// cmd is a middleware pattern for orchestrating cli commands
const noOpMiddleware = async (argv, next) => next(argv)
const cmd = (initialMiddleware = noOpMiddleware) => {
  const _cmd = async (argv) => {
    const cont = (rem) => async (...args) => {
      if (rem.length === 0) return
      const [m, ...rest] = rem
      return await m((args.length >= 1 ? args[0] : argv), cont(rest))
    }
    return await cont(_cmd._middleware)(argv)
  }
  _cmd._middleware = [initialMiddleware]
  _cmd.use = (middleware) => {
    _cmd._middleware.push(middleware)
    return _cmd
  }
  _cmd.do = _cmd.use // alias
  return _cmd
}

const demandOption = (option, checkFn = (v) => !!v) => async (argv, next) => {
  if (!checkFn(argv[option])) {
    console.error(`Missing required argument: ${option}`)
    process.exit(1)
  } else {
    return await next(argv)
  }
}

const requestOption = (option, requestFn) => async (argv, next) => {
  if (argv[option]) return await next()
  argv[option] = await requestFn(argv)
  return await next()
}

const authenticateUser = async (argv, next) => {
  logger.verbose('check for token in local storage')
  const db = await getDb()
  if (db.data.userToken) {
    logger.verbose('verify token')
    argv.api.authenticateUserToken(db.data.userToken)
    const isloggedIn = await argv.api.status()
    if (isloggedIn) {
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
    return await next()
  }
  return await authenticateUser(argv, next)
}

const requestSite = requestOption('site', async (argv) => {
  if (isInteractive) {
    const sites = await argv.api.getSites()
    if (sites.length === 0) {
      console.error('You need to create a site first using the `init` command')
      process.exit(1)
    }
    return await prompts.select({
      message: 'Select a site',
      choices: sites.map(({
        siteId,
        name,
        customDomain,
        deployedAt,
        createdAt
      }) => ({
        name: `${name} [${customDomain || getSiteDomain(siteId)}]`,
        value: siteId,
        description: deployedAt ? `last published ${moment(deployedAt).fromNow()}` : `created ${moment(createdAt).fromNow()}`
      }))
    })
  }
})

module.exports = async function main (inArgv = process.argv) {
  const cli = yargs(hideBin(inArgv))
    .scriptName('statchic') // TODO

    .usage(`${chalk.bold('$0')}   ` +
        chalk.green('Create and deploy static sites on', chalk.underline('static-chic.online') + '.\n\n') +

        '  $0 init\n' +
        '  $0 deploy --promote myapp/dist\n\n' +

        chalk.bold('Authentication') + '\n' + chalk.dim(chalk.underline('static-chic.online'),
        'uses GitHub for authentication. When running interactively it will prompt for you ' +
        'to log in if needed and store your authentication token on your device.\n\n') +

        chalk.bold('Deploy Key') + '\n' + chalk.dim(
        'When running non-interactively, such as during a CI ' +
        'build process, most commands can instead use a deploy key. A deploy key is generated ' +
        'when a site is initialized. Set this value to an `SC_DEPLOY_KEY` environment variable ' +
        'in your build environment to authenticate deployments and promotions.\n\n') +

        chalk.bold('Custom Domains') + '\n' + chalk.dim(
        'Every site is given a site ID which is used as a unique subdomain, e.g. `' +
        chalk.underline('teeny-angle-dwas5.site.static-chic.online') + '`. ' +
        'In addition, you can specify a custom domain, like `' + chalk.underline('www.example.com') + '`. ' +
        'SSL certificate will be automatically provisioned. You will need to create a CNAME record ' +
        'pointing this domain to the default domain for the site before you can attach it to the site. ' +
        'Contact your DNS provider for directions.\n\n')
    )
  cli.siteOption = function () {
    return this.option('site', {
      alias: 's',
      type: 'string',
      describe: 'The site subdomain, e.g. `teeny-angle-dwas5`'
    })
      .default('site', () => {
        if (process.env.SC_SITE_ID) return process.env.SC_SITE_ID
      }, '$SC_SITE_ID')
  }

  cli.command('init', chalk.bold('Create a new site.'), y =>
    y.option('name', {
      alias: 'n',
      describe: 'A name for the site'
    }), cmd()
    .use(authenticateUser)
    .use(requestOption('name', async () => {
      if (isInteractive) {
        return await prompts.input({ message: 'Enter a name for the site:', required: false })
      }
    }))
    .do(init)
  )

    .command('configure', chalk.bold('Change the settings of a site.'), y =>
      y.example('configure --site teeny-angle-dwas5 --domain example.com')
        .siteOption()
        .option('domain', {
          alias: 'd',
          string: true,
          boolean: true,
          describe: 'Add a custom domain to the site. Remove it by setting to blank or using `--no-domain`'
        })
        .coerce('domain', (arg) => (typeof arg === 'boolean' ? null : (arg === '' ? null : arg))),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .do(configure))

    .command('deploy [path]', chalk.bold('Create a new deployment for the site.\n') +
        chalk.dim('A deployment isn\'t automatically promoted to live by default. Use the ' +
        '`promote` command or the `--promote` flag to promote after deployment.'), y =>
      y.example('deploy --site teeny-angle-dwas5 --promote --wait myapp/dist')
        .positional('path', { describe: 'The path to the root directory of static files', normalize: true })
        .siteOption()
        .option('message', { alias: 'm', describe: 'an optional description of the deployment' })
        .option('exclude', { alias: 'x', describe: 'a glob of files relative to `path` to exclude from the deployment', type: 'array', default: [] })
        .option('promote', { alias: 'p', describe: 'promote after deployment', type: 'boolean' })
        .option('wait', { alias: 'w', describe: 'wait for the process to complete', type: 'boolean' })
        .option('dry-run', { describe: 'list the files to be included but do not deploy' })
        .demandOption('path')
        .implies('wait', 'promote'),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .do(deploy))

    .command('promote [deployment]', chalk.bold('Make a deployment live.'), y =>
      y.example('promote --wait --site teeny-angle-dwas5 0000019cd5515615dd304c19')
        .siteOption()
        .positional('deployment', {
          describe: 'The ID of the deployment to promote, e.g. `0000019cd5515615dd304c19`.'
        }).default('deployment', () => {
          if (process.env.SC_DEPLOY_ID) return process.env.SC_DEPLOY_ID
        }, '$SC_DEPLOY_ID')
        .option('wait', { alias: 'w', describe: 'wait for the invalidation to complete', type: 'boolean' }),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(requestOption('deployment', async (argv) => {
        if (isInteractive) {
          // TODO: get the site's deployments
          const deployments = await argv.api.getDeployments({ siteId: argv.site })
          if (deployments.length === 0) {
            console.error('No deployments for this site. Create one using the `deploy` command')
            process.exit(1)
          }
          return await prompts.select({
            message: 'Select a deployment',
            choices: deployments.map(({ message, deploymentId, createdAt }) => ({
              name: message ? `${message} [${deploymentId}]` : `[${deploymentId}]`, // TODO bold if active
              value: deploymentId,
              description: `created ${moment(createdAt).fromNow()}`
            }))
          })
        }
      }))
      .use(demandOption('deployment'))
      .do(promote))

  // authenticate user or deploykey
  // if interactive, show a list of deployments else if specified else -n count else -n -1
  // .command('rollback')

  // .command('destroy')

    .help('help')
    .command('help', false, (y) => y, (argv) => { cli.showHelp() })
    .alias('help', 'h')
    .option('verbose', { alias: 'v', describe: 'verbose logging' })
    .demandCommand(1, 1, 'command required')
    .strictCommands()
    .middleware((argv) => {
      logger = require('./logger').configure({ level: argv.verbose ? 'verbose' : 'warn', pretty: true }).getLogger()
      // TODO: hard-coded dev
      argv.api = new Api(process.env.SC_HOSTNAME || API_HOST)
      argv.deployKey = process.env.SC_DEPLOY_KEY
    })

  cli.wrap(Math.min(cli.terminalWidth(), 120))
  await cli.parse()
}

async function init (argv) {
  const { name } = argv
  logger.info(`creating new site: ${name}`)
  const { siteId, deployKey } = await argv.api.createSite({ name })

  if (isInteractive) {
    console.log(chalk.green('Site created: ') + chalk.bold(`${siteId}.sites.dev.static-chic.online`))
    console.warn(chalk.gray("This deploy key can be used to deploy your site from a CI server. Be sure to save it, we'll only show it once."))
    console.log(chalk.bold('Deploy key: ') + deployKey)
  } else {
    console.log(`SC_SITE_ID=${siteId} SC_DEPLOY_KEY=${deployKey}`)
  }
  process.exit(0)
}

async function configure (argv) {
  try {
    const { siteId, customDomain } = await argv.api.updateSite({ siteId: argv.site, customDomain: argv.domain })
    if (isInteractive) {
      if (customDomain) {
        console.log(chalk.green('Your site is now available at ') + chalk.underline(customDomain))
      } else {
        console.log(chalk.green('Custom domain removed. ') +
          'You can still access your site at ' + chalk.underline(getSiteDomain(siteId)))
      }
    }
    process.exit(0)
  } catch (err) {
    if (err instanceof ApiError) {
      logger.warn(err.message)
      process.exit(1)
    }
  }
}

async function deploy (argv) {
  const { message, exclude, dryRun } = argv

  if (dryRun) {
    const files = await require('./files').allFilesRelative(argv.path, { exclude })
    for (const file of files) {
      console.log(file)
    }

    process.exit(0)
  }

  const { deploymentId, siteId, uploadPath, credentials } = await argv.api.deploy({ siteId: argv.site, message })

  const tarball = await require('./files').createTarball(argv.path, { exclude, dryRun })
  await require('./s3').upload(uploadPath, tarball, { credentials })

  if (argv.wait) {
    await argv.api.waitForDeployment({ siteId, deploymentId })
  }

  if (argv.promote) {
    argv.deployment = deploymentId
    await promote(argv)
  } else {
    if (isInteractive) {
      console.log(`Deployment Created: ${deploymentId}`)
    } else {
      console.log(deploymentId)
    }
  }
  process.exit(0)
}

async function promote (argv) {
  // siteId, deployedAt, state, deployment
  // deploymentId, siteId, message, createdAt, state, credentials
  await argv.api.promote({ siteId: argv.site, deploymentId: argv.deployment })

  if (argv.wait) {
    await argv.api.waitForSite({ siteId: argv.site })
  }

  if (isInteractive) {
    console.log(`Deployment ${argv.deployment} is now live.`)
    if (!argv.wait) {
      console.log('It may take a few minutes for the CDN to invalidate. You may also have to clear your browser cache.')
    }
  } else {
    console.log(argv.deployment)
  }
}
