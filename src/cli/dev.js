process.env.API_HOST = 'https://api.dev.chicy.online'
process.env.SITE_DOMAIN = 'sites.dev.chicy.online'
require('@dotenvx/dotenvx').config({ quiet: true, overload: false })
require('./cli')()
