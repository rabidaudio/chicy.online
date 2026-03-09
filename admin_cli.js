const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')

const app = require('./app')

function main () {
  yargs(hideBin(process.argv))
    .command('get_user <username>', 'check the status of a user', (yargs) => {
      return yargs.positional('username', { describe: 'the unique username of the user' })
    }, async (argv) => {
      const user = await app.getUser(argv.username)

      if (user) {
        console.log(user)
      } else {
        console.error(`No user found for username "${argv.username}"`)
      }
    })
    .command('add_user <username> [details]', 'create a new user', (yargs) => {
      return yargs
        .positional('username', { describe: 'the unique username of the user' })
        .alias('n', 'name').describe('n', 'The display name of the user')
        .demandOption(['n'])
    }, async (argv) => {
      // TODO: auth tokens?

      const user = await app.createUser({ userId: argv.username, name: argv.name })
      console.log(user)
    })
    .command('list_sites <username>', 'show all the sites managed by the user', (yargs) => {
      return yargs
        .positional('username', { describe: 'the username of the user' })
    }, async (argv) => {
      // TODO: auth tokens?

      const sites = await app.listSitesForUser(argv.username)
      console.log(sites)
    })

  // exports. = async (userId) => {

    .command('add_site', 'create a new site', (yargs) => {
      return yargs
        .example('add_site -o [username] -n [name]')
        .alias('o', 'owner').describe('o', 'The username of the site owner')
        .alias('n', 'name').describe('n', 'The name of the site')
        .demandOption(['o', 'n'])
    }, async (argv) => {
      const site = await app.createSite({ name: argv.name, userId: argv.owner })
      console.log(site)
    })

    .command('deploy [path]', 'create a deployment to the given site', (yargs) => {
      return yargs
        .example("deploy myapp/dist --site [siteId] --exclude '**/*.test.js'")
        .positional('path', { describe: 'The path to the root directory of static files' })
        .option('site', {
          alias: 's',
          describe: 'the siteId to deploy to'
        })
        .option('exclude', {
          alias: 'x',
          describe: 'a glob of files relative to `path` to exclude',
          type: 'array',
          default: []
        })
        .option('promote', {
          alias: 'p',
          describe: "Also promote the deployment.\nA deployment isn't automatically promoted to live by default",
          type: 'boolean'
        })
        .demandOption(['site'])
    }, async (argv) => {
      console.log("zipping and uploading...")
      const contentTarball = await app.createTarball(argv.path) // TODO: exclude
      const deployment = await app.createDeployment({ siteId: argv.site, contentTarball })
      console.log(deployment)
      if (argv.promote) {
        console.log("promoting...")
        const site = await app.promoteDeployment(deployment)
        console.log(site)
      }
    })

    .command([
      'promote [siteId] [deploymentId]',
      'rollback [siteId] [deploymentId]'
    ], 'make the distribution live', (yargs) => {
      return yargs
        .positional('siteId')
        .positional('deploymentId')
        .option('wait', {
          alias: 'w',
          describe: "wait for the invalidation to complete",
          type: "boolean",
        })
    }, async (argv) => {
        console.log(argv)
        const { siteId, deploymentId } = argv
        console.log("promoting...")
        const site = await app.promoteDeployment({ siteId, deploymentId })
        console.log(site)
        if (argv.wait) {
          // TODO: wait until invalidation complete
        }
    })

    .help('h')
    .alias('h', 'help')
    .demandCommand(1, 1, 'command required')
    .parse()
}

main()
