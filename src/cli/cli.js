const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const prompts = require('@inquirer/prompts')
const chalk = require('chalk')

const logManger = require('../logger')
const logger = logManger.getLogger()

const Config = require('../config')

const { Api } = require('./api')
const {
  BIN_NAME, APP_NAME, API_HOST,
  isInteractive,
  getSiteDomain, relativeTime,
  cmd, demandOption, requestOption
} = require('./utils')

const {
  init, showSites, configure, regenerateKey,
  showDeployments, deploy, promote, removeSite,
  authenticateUser, authenticateDeployKeyOrUser,
  resolveSite
} = require('./commands')

module.exports = async function main (inArgv = process.argv) {
  const cli = yargs(hideBin(inArgv))
    .scriptName(BIN_NAME)

    .usage(`${chalk.bold('$0')}   ` +
        chalk.green('Create and deploy static sites on', chalk.underline(APP_NAME) + '.\n\n') +

        chalk.black('  $0 init\n') +
        chalk.black('  $0 deploy myapp/dist --promote --wait\n\n') +

        chalk.bold('Authentication') + '\n' + chalk.dim(chalk.underline(APP_NAME),
        'uses GitHub for authentication. When running interactively it will prompt for you ' +
        'to log in if needed and store your authentication token on your device.\n\n') +

        chalk.bold('Deploy Key') + '\n' + chalk.dim(
        'When running non-interactively, such as during a CI ' +
        'build process, most commands can instead use a deploy key. A deploy key is generated ' +
        'when a site is initialized. Set this value to the ' + chalk.bold('CHICY_DEPLOY_KEY') +
        ' environment variable in your build environment to authenticate deployments and promotions.\n\n') +

        chalk.bold('Custom Domains') + '\n' + chalk.dim(
        'Every site is given a site ID which is used as a unique subdomain, e.g. `' +
        chalk.underline(getSiteDomain('teeny-angle-dwas5')) + '`. ' +
        'In addition, you can specify a custom domain, like `' + chalk.underline('www.example.com') + '`. ' +
        'SSL certificate will be automatically provisioned. You will need to create a CNAME record ' +
        'pointing this domain to the default domain for the site before you can attach it to the site. ' +
        'Contact your DNS provider for directions.\n\n')
    )
  cli.siteOption = function () {
    return this.option('site', {
      alias: 's',
      type: 'string',
      describe: 'The site subdomain, e.g. ' + chalk.bold('teeny-angle-dwas5')
    })
      .default('site', () => {
        if (process.env.CHICY_SITE_ID) return process.env.CHICY_SITE_ID
      }, '$CHICY_SITE_ID')
  }

  cli.command('init', chalk.bold('Create a new site.'), y =>
    y.option('name', {
      alias: 'n',
      describe: 'A name for the site'
    }).option('generate-config', {
      description: 'By default, ' + chalk.italic('init') + ' generates a template config file to use with the site ' +
        "if one doesn't already exist. You can disable this with " + chalk.italic('--no-generate-config'),
      type: 'boolean',
      default: true
    }), cmd()
    .use(authenticateUser)
    .use(requestOption('name', async () => {
      if (isInteractive) {
        return await prompts.input({ message: 'Enter a name for the site:', required: false })
      }
    }))
    .do(init))

    .command('sites', chalk.bold('list sites attached to account.'), y => y,
      cmd()
        .use(authenticateUser)
        .do(showSites))

    .command('configure', chalk.bold('Change the settings of a site.'), y =>
      y.example('configure --site teeny-angle-dwas5 --domain example.com')
        .siteOption()
        .option('domain', {
          alias: 'd',
          string: true,
          describe: 'Add a custom domain to the site. Remove it by setting to blank or using ' +
            chalk.dim('--no-domain')
        })
        .coerce('domain', (arg) => (typeof arg === 'boolean' ? null : (arg === '' ? null : arg))),
    cmd()
      .use(authenticateUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .do(configure))

    .command('regenerate', chalk.bold('Generate a new deploy key.'), y =>
      y.example('regenerate --site teeny-angle-dwas5')
        .siteOption(),
    cmd()
      .use(authenticateUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .do(regenerateKey))

    .command('deployments', chalk.bold('list deployments for a site.'), y =>
      y.example('deployments --site teeny-angle-dwas5')
        .siteOption(),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .do(showDeployments))

    .command('deploy [path]', chalk.bold('Create a new deployment for the site.\n') +
        chalk.dim('A deployment isn\'t automatically promoted to live by default. Use the ' +
        chalk.italic('promote') + ' command or the ' + chalk.italic('--promote') +
        ' flag to promote after deployment.'), y =>
      y.example('deploy --site teeny-angle-dwas5 --promote --wait myapp/dist')
        .positional('path', { describe: 'The path to the root directory of static files', normalize: true })
        .siteOption()
        .option('message', { alias: 'm', describe: 'an optional description of the deployment' })
        .option('exclude', {
          alias: 'x',
          describe: 'a glob of files relative to ' + chalk.italic('path') + ' to exclude from the deployment. ' +
            'These are in addition to any defined in the config file.',
          type: 'array',
          default: []
        })
        .option('promote', { alias: 'p', describe: 'promote after deployment', type: 'boolean' })
        .option('wait', { alias: 'w', describe: 'wait for the process to complete', type: 'boolean' })
        .option('dry-run', { describe: 'list the files to be included but do not deploy' })
        .demandOption('path'),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .do(deploy))

    .command(['promote [deployment]', 'rollback [deployment]'], chalk.bold('Make a deployment live.'), y =>
      y.example('promote --wait --site teeny-angle-dwas5 0000019cd5515615dd304c19')
        .siteOption()
        .positional('deployment', {
          describe: 'the ID of the deployment to promote, e.g. ' + chalk.bold('d_0000019cd5515615dd304c19') + '.'
        }).default('deployment', () => {
          if (process.env.CHICY_DEPLOY_ID) return process.env.CHICY_DEPLOY_ID
        }, '$CHICY_DEPLOY_ID')
        .option('wait', { alias: 'w', describe: 'wait for the invalidation to complete', type: 'boolean' }),
    cmd()
      .use(authenticateDeployKeyOrUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .use(requestOption('deployment', async (argv) => {
        if (isInteractive) {
          // TODO: get the site's deployments
          const deployments = await argv.api.getDeployments({ siteId: argv.site })
          if (deployments.length === 0) {
            console.error('No deployments for this site. Create one using the ' + chalk.italic('deploy') + ' command')
            process.exit(1)
          }
          return await prompts.select({
            message: 'Select a deployment',
            choices: deployments.map(({ message, deploymentId, createdAt, isLive }) => {
              const name = message ? `${message} [${deploymentId}]` : `[${deploymentId}]`
              return {
                name: isLive ? chalk.bold('*' + name) : name,
                value: deploymentId,
                description: `created ${relativeTime(createdAt)}`
              }
            })
          })
        }
      }))
      .use(demandOption('deployment'))
      .do(promote))

    .command('remove', chalk.bold('delete a site.'), y =>
      y.example('remove --site teeny-angle-dwas5')
        .siteOption()
        .option('skip-confirm', {
          alias: 'y',
          describe: 'do not ask for confirmation before deleting',
          type: 'boolean',
          default: false
        }),
    cmd()
      .use(authenticateUser)
      .use(requestSite)
      .use(demandOption('site'))
      .use(resolveSite)
      .do(removeSite))

    .help('help')
    .command('help', false, (y) => y, (argv) => { cli.showHelp() })
    .alias('help', 'h')
    .option('verbose', { alias: 'v', describe: 'verbose logging' })
    .option('config', {
      alias: 'c',
      describe: `Path to a "${Config.CONFIG_NAME}" config file to use.`,
      normalize: true
    })
    .default('config', () => {
      if (process.env.CHICY_CONFIG) return process.env.CHICY_CONFIG
      return null
    }, `$CHICY_CONFIG or ${Config.CONFIG_NAME}`)
    .demandCommand(1, 1, 'command required')
    .strictCommands()
    .middleware(async (argv) => {
      // We do this here because we need to figure out verobsity level before importing logger and any
      // dependencies that expect it
      logManger.configure({ level: argv.verbose ? 'verbose' : 'warn' })
      logger.verbose('arguments', argv)
      if (process.env.CHICY_HOSTNAME) logger.verbose(`Using alternate host: ${process.env.CHICY_HOSTNAME}`)
      argv.api = new Api(process.env.CHICY_HOSTNAME || API_HOST)
      argv.deployKey = process.env.CHICY_DEPLOY_KEY

      const configPath = argv.config
      const loadedConfig = await Config.findConfig(configPath)
      if (configPath && !loadedConfig) {
        console.error(chalk.red("Couldn't find config file at ") + chalk.dim(configPath))
        process.exit(1)
      }
      argv.config = loadedConfig || Config.generateDefaultConfig()
      logger.verbose(`using config from ${configPath || 'default location'}`, argv.config)
    })

  cli.wrap(Math.min(cli.terminalWidth(), 120))
  await cli.parse()
}

const requestSite = requestOption('site', async (argv) => {
  // use value from config file
  if (argv.config && argv.config.siteId) {
    return argv.config.siteId
  }

  if (isInteractive) {
    const sites = await argv.api.getSites()

    if (sites.length === 0) {
      console.error(chalk.yellow('You need to create a site first using the ' + chalk.italic('init') + ' command.'))
      process.exit(1)
    }
    return await prompts.select({
      message: 'Select a site',
      choices: sites.map(({
        siteId,
        name,
        customDomain,
        baseDomain,
        deployedAt,
        createdAt
      }) => {
        let displayName = chalk.bold(siteId) + ' [' + chalk.underline(customDomain || baseDomain) + ']'
        if (name) displayName = name + ' ' + displayName
        return {
          name: displayName,
          value: siteId,
          description: deployedAt
            ? `last published ${relativeTime(deployedAt)}`
            : `created ${relativeTime(createdAt)}`
        }
      })
    })
  }
})
