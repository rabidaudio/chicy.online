const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const chalk = require('chalk')
const prompts = require('@inquirer/prompts')

const s3 = require('../s3')
const db = require('../db')
const Sites = require('../sites')
const Migrations = require('./migrations')

const logger = require('../logger').configure({ level: 'verbose' }).getLogger()

module.exports = async function main () {
  const cli = yargs(hideBin(process.argv))
    .scriptName('admin')
    .usage('Internal cli for administering deployments. ' +
        'Requires AWS to be authenticated locally with permissions to access all ' +
        'the services used by the app. It also requires a sls-{stage}.env file with ' +
        'the environment variables of the server set.')
    .option('stage', {
      alias: 's',
      describe: 'The environment to run against',
      default: 'dev'
    })
    .command('users', 'List users', y => y, async (argv) => {
      const users = await Array.fromAsync(db.scan('users'))
      const sanitized = users.map(({
        userId, login, name, email, createdAt, accessTokenExpiresAt, refreshTokenExpiresAt
      }) => ({
        userId, login, name, email, createdAt, accessTokenExpiresAt, refreshTokenExpiresAt
      }))
      for (const user of sanitized) {
        console.log(user)
      }
    })
    .command('sites', 'List sites', y =>
      y.option('user', {
        describe: 'list for a specific user',
        default: null
      }), async (argv) => {
      // TODO: paginate
      let sites
      if (argv.user) {
        sites = await db.query('sites', { userId: argv.user }, { idx: 'idxUserId', asc: false, limit: 100 })
      } else {
        sites = await Array.fromAsync(db.scan('sites'))
      }
      const sanitized = sites.map(({
        siteId, name, state, tenantId, userId, currentDeploymentId, createdAt,
        deployedAt, deployKeyLastUsedAt, customDomain, domainAttached, gitInitialized
      }) => ({
        siteId,
        name,
        state,
        tenantId,
        userId,
        currentDeploymentId,
        createdAt,
        deployedAt,
        deployKeyLastUsedAt,
        customDomain,
        domainAttached,
        gitInitialized
      }))
      for (const site of sanitized) {
        console.log(site)
      }
    })
    .command({
      command: 'migrate',
      description: 'Manage migrating data for new deployments',
      builder: (yargs) => {
        return yargs.command({
          command: 'new [message]',
          description: 'Create a new migration',
          builder: y => y.positional('message', {
            describe: 'A short description of the task'
          }),
          handler: async (argv) => {
            if (!argv.message) {
              argv.message = await prompts.input({ message: 'Enter a description for the migration:', required: true })
            }
            const { path } = await Migrations.create(argv.message)
            console.log(`Migration created: ${path}`)
          }
        }).command({
          command: 'ls',
          description: 'List all migrations and their states',
          handler: async (argv) => {
            const state = await Migrations.getMigrationState()
            state.reverse()
            if (state.length === 0) {
              console.warn(chalk.yellow('No migrations created yet.'))
            }
            for (const { migrationId, timestamp, message, run } of state) {
              console.log((run ? chalk.green('✓') : chalk.red('𐄂')) + ` ${message} (${timestamp.fromNow()}) [${migrationId}]`)
            }
          }
        }).command({
          command: 'all',
          description: 'Run all pending migrations',
          handler: async (argv) => {
            const run = await Migrations.runAll()
            if (run.length === 0) {
              console.log(chalk.yellow('Up-to-date, no pending migrations.'))
            } else {
              console.log(chalk.green(`${run.length} migrations completed.`))
            }
          }
        }).command({
          command: 'up',
          description: 'Run the next pending migration',
          handler: async (argv) => {
            await Migrations.up()
            console.log('Migration complete.')
          }
        }).command({
          command: 'down',
          description: 'Rollback the most recent migration',
          handler: async (argv) => {
            await Migrations.down()
            console.log('Rollback complete.')
          }
        }).command({
          command: 'initenv',
          description: 'Mark all migrations as run (for new environments)',
          handler: async (argv) => {
            await Migrations.initNewEnvironment()
            console.log('Migrations initialized.')
          }
        })
      }
    })
    .command('wipe', 'Wipe all users and sites', y => y, async (argv) => {
      console.warn(`Are you sure you want to delete everything from stage ${argv.stage}?`)
      const stage = await prompts.input({ message: 'enter the stage name to continue' })
      if (stage !== argv.stage) {
        console.log('Aborted')
        process.exit(10)
      }
      for await (const { siteId } of db.scan('sites')) {
        await Sites.delete(siteId)
      }

      logger.info('wiping data')
      for (const bucket of [process.env.APP_BUCKET_NAME, process.env.UPLOADS_BUCKET_NAME]) {
        await s3.deleteRecursive('', { bucket })
      }

      logger.info('deleting users')
      for await (const { userId } of db.scan('users')) {
        await db.delete('users', { userId })
        logger.info(`deleted user ${userId}`)
      }
    })
    .help('help')
    .middleware(async (argv) => {
      // load the environment from the server
      // Ideally we could do this from a serverless command but they don't support
      // it and the plugins that try to are broken
      require('@dotenvx/dotenvx').config({ path: `sls-${argv.stage}.env` })
    })
    .demandCommand(1, 1, 'command required')
    .strictCommands()

  await cli.parse()
}
