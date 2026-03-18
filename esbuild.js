const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const esbuild = require('esbuild')

function build (command) {
  switch (command) {
    case 'all':
      ['cli', 'lambda:api', 'lambda:s3'].forEach(c => build(c))
      break
    case 'cli':
      console.log('Building cli')
      esbuild.buildSync({
        entryPoints: ['src/cli/index.js'],
        bundle: true,
        define: {
          'process.env.BIN_NAME': '\'statchic\'',
          'process.env.APP_NAME': '\'static-chic.online\'',
          'process.env.API_HOST': '\'https://api.static-chic.online\'',
          'process.env.SITE_DOMAIN': '\'sites.static-chic.online\''
        },
        minify: true,
        platform: 'node',
        packages: 'external',
        target: ['node20.20'],
        outfile: 'dist/cli.js'
      })
      break
    case 'lambda:api':
      console.log('Building api lambda handler')
      esbuild.buildSync({
        entryPoints: ['api.handler.js'],
        bundle: true,
        // minify: true,
        platform: 'node',
        packages: 'external',
        target: ['node24'],
        outfile: 'dist/api_handler.js'
      })
      break
    case 'lambda:s3':
      console.log('Building s3 lambda handler')
      esbuild.buildSync({
        entryPoints: ['s3.handler.js'],
        bundle: true,
        // minify: true,
        platform: 'node',
        packages: 'external',
        target: ['node24'],
        outfile: 'dist/s3_handler.js'
      })
      break
    default:
      throw new Error(`Unknown build command ${command}`)
  }
}

function main () {
  const argv = yargs(hideBin(process.argv)).parse()
  if (argv._.length === 0) {
    build('all')
  } else {
    for (const command of argv._) {
      build(command)
    }
  }
}

main()
