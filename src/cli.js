const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const prompts = require('@inquirer/prompts')
const chalk = require('chalk')

const isInteractive = require('is-interactive').default()
const supportsColor = require('supports-color').default.stdout

// cmd is a middleware pattern for orchestrating cli commands
const cmd = function(initialMiddleware = async (argv, next) => next(argv)) {
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
    return _cmd
}

//     for (const [name, extension] of Object.entries(cmd.extensions)) {
//         _cmd.
//     }
// cmd.extensions = []
// cmd.extend = (extender) => cmd.extensions.push(extender)


// cli.extend({
//     demandOption: (name, checkFn = (v) => !!v) => async (argv, next) => {
//         if (!checkFn(argv[name])) {
//             console.error(`Missing required argument: ${name}`)
//             process.exit(1)
//         } else {
//             return await next(argv)
//         }
//     },
// })

const.demandOption = (name, checkFn = (v) => !!v) => a

const requestOption = (option, requestFn) => async (argv, next) => {
    if (argv[option]) return await next()
    const resolved = await requestFn(argv)
    return await next({ ...argv, [option]: resolved })
}
})

// const cli = function () { // TODO: allow specifying first use as argument
//     const fn = async (argv) => {
//         // Top invoke
//         console.log('top invoke', argv, fn._next)
//         if (fn._next)
//             return await fn._next(argv)
//     }
//     fn._next = null
//     const attachUse = (fn) => {
//         fn.use = function (middleware) {
//             // set fn.next to be this
//             fn._next = async function (argv) {
//                 console.log('invoke middleware', argv)
//                 const next = this._next || (async (_argv) => {})
//                 return await middleware(argv, async () => next(argv))
//             }
//             // set fn.use to be this function's use
//             fn.use = attachUse(fn._next)
//         }        
//     }
//     attachUse(fn)
//     return fn
// }

    // .chain(authenticate)
    // .requestOption('site', async () => {

    // })
    // .demandOption('site')
    // .chain(async (argv, next) => {

    // })

// const cli = new CLI(yargs)
//     .cmd('init', authenticate, requireSite, async ({ name }) => {
//         // authenticate
//         // new site (--name or interactive or null)
//         // return new subdomain+deploy_key
//     })


const authenticate = async () => {
  // check auth token in localStorage
  //  exists? return it
  // interactive? go through login flow
  // throw error token or deploy key is required
  // TODO: support non-interactive registration?
}

const demandOption = (name, checkFn = (v) => !!v) => async (argv, next) => {
    if (!checkFn(argv[name])) {
        console.error(`Missing required argument: ${name}`)
        process.exit(1)
    } else {
        return await next(argv)
    }
}

const requestOption = (option, requestFn) => async (argv, next) => {
    if (argv[option]) return await next()
    const resolved = await requestFn(argv)
    return await next({ ...argv, [option]: resolved })
}

const requestSite = requestOption('site', async () => {
    if (isInteractive) {
        // TODO: get the user's sites
        return await prompts.select({
            message: 'Select a site',
            choices: [
                { name: 'Test Site [teeny-angle-dwas5]', value: 'teeny-angle-dwas5', description: 'created today' },
                { name: 'Test Site 2 [example.com]', value: 'foo-bar-baz', description: 'updated 1 year ago' }
            ]
            })
    }
})

const requestDeployment = requestOption('deployment', async () => {

})

module.exports = async function main () {
  const yargs = yargs(hideBin(process.argv))
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
  yargs.siteOption = function () {
    return this.option('site', {
      alias: 's',
      type: 'string',
      describe: 'The site subdomain, e.g. `teeny-angle-dwas5`'
    }).unwrappedDefault('site', async () => {
      if (process.env.SC_SITE_ID) return process.env.SC_SITE_ID
    }, '$SC_SITE_ID').demandOption('site')
  }

  yargs.command('init', chalk.bold('Create a new site.'), y =>
    y.option('name', {
      alias: 'n',
      describe: 'A name for the site'
    }).unwrappedDefault('name', async () => {
      if (isInteractive) {
        return await prompts.input({ message: 'Enter a name for the site:', required: false })
      }
      return null
    }, 'none'))

    .command('configure', chalk.bold('Change the settings of a site.'), y =>
      y.example('configure --site teeny-angle-dwas5 --domain example.com')
        .siteOption()
        .option('domain', {
          alias: 'd',
          string: true,
          boolean: true,
          describe: 'Add a custom domain to the site. Remove it by setting to blank or using `--no-domain`'
        })
        .coerce('domain', (arg) => (typeof arg === 'boolean' ? null : (arg === '' ? null : arg))))

    .command('deploy [path]', chalk.bold('Create a new deployment for the site.\n\n') +
        chalk.dim('A deployment isn\'t automatically promoted to live by default. Use the ' +
        '`promote` command or the `--promote` flag to promote after deployment.'), y =>
      y.example('deploy --site teeny-angle-dwas5 --promote --wait myapp/dist')
        .positional('path', { describe: 'The path to the root directory of static files', normalize: true })
        .siteOption()
        .option('exclude', { alias: 'x', describe: 'a glob of files relative to `path` to exclude from the deployment', type: 'array', default: [] })
        .option('promote', { alias: 'p', describe: 'promote after deployment', type: 'boolean' })
        .option('wait', { alias: 'w', describe: 'wait for the invalidation to complete (if also promoting)', type: 'boolean' })
        .demandOption('path')
        .implies('wait', 'promote'))

  // authenticate user or deploykey
  // siteId/deployId
  .command('promote [deployment]', chalk.bold('Make a deployment live.'), y =>
    y.example("promote --wait --site teeny-angle-dwas5 0000019cd5515615dd304c19")
    .siteOption()
    .positional('deployment', {
        describe: 'The ID of the deployment to promote, e.g. `0000019cd5515615dd304c19`.'
    }).unwrappedDefault('deployment', async () => {
        if (process.env.SC_DEPLOY_ID) return process.env.SC_DEPLOY_ID
        if (isInteractive) {
            // TODO: get the site's deployments
            return await prompts.select({
            message: 'Select a deployment',
            choices: [
                { name: chalk.bold('*added new posts [d55156]'), value: 'd55156', description: 'created today' },
                { name: 'initial [304c19]', value: '304c19', description: 'updated 1 year ago' }
            ]
            })
        }
    }, '$SC_DEPLOY_ID')
    .option('wait', { alias: 'w', describe: 'wait for the invalidation to complete', type: 'boolean' })
    .demandOption('deployment'))

  // authenticate user or deploykey
  // if interactive, show a list of deployments else if specified else -n count else -n -1
  // .command('rollback')

    .help('help')
    .command('help', false, (y) => y, (argv) => { cli.showHelp() })
    .alias('help', 'h')
    // .option('verbose', { alias: 'v', describe: 'verbose logging' })
    .demandCommand(1, 1, 'command required')
    .strictCommands()

  const argv = await yargs.parse()
  console.log(argv)
}

async function init ({ name }) {
  // authenticate
  // new site (--name or interactive or null)
  // return new subdomain+deploy_key
}

async function configure ({ site, domain }) {
  // authenticate
  // verify domain
  // set domain (--domain or interactive or error)
  // print ok
}

async function deploy ({ site }) {
  // authenticate user or deploykey
  // siteId flag or env var or interactive
  // tarball [path], --exclude or interactive
  // deploy
  // if --promote also promote
  // if --wait also wait (if interactive wait by default)
}
