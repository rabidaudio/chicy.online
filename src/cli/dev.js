process.env.API_HOST = 'https://api.dev.chicy.online'
process.env.SITE_DOMAIN = 'sites.dev.chicy.online'
process.env.APP_NAME = 'chicy-dev'
require('@dotenvx/dotenvx').config({ quiet: true, overload: false })
require('./cli')()
