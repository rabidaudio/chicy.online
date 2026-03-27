const moment = require('moment')

// These are injected during esbuild
const BIN_NAME = process.env.BIN_NAME
const APP_NAME = process.env.APP_NAME
const API_HOST = process.env.API_HOST
const SITE_DOMAIN = process.env.SITE_DOMAIN
if (!BIN_NAME || !APP_NAME || !API_HOST || !SITE_DOMAIN) throw new Error('Configuration missing')

const getSiteDomain = (siteId) => `${siteId}.${SITE_DOMAIN}`

const relativeTime = (time) => time ? moment(time).fromNow() : 'never'

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

module.exports = {
  BIN_NAME,
  APP_NAME,
  API_HOST,
  SITE_DOMAIN,
  relativeTime,
  getSiteDomain,
  cmd,
  demandOption,
  requestOption
}
