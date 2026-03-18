const consoleTablePrinter = require('console-table-printer')
const CliTable = require('cli-table3')
const moment = require('moment')

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'sites.dev.static-chic.online'

const isInteractive = require('is-interactive').default()

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

const showTable = (data) => {
  if (isInteractive) {
    consoleTablePrinter.printTable(data)
  } else {
    const table = new CliTable({
      chars: {
        top: '',
        'top-mid': '',
        'top-left': '',
        'top-right': '',
        bottom: '',
        'bottom-mid': '',
        'bottom-left': '',
        'bottom-right': '',
        left: '',
        'left-mid': '',
        mid: '',
        'mid-mid': '',
        right: '',
        'right-mid': '',
        middle: '  '
      },
      style: { 'padding-left': 0, 'padding-right': 0 }
    })
    if (data[0]) table.push(Object.keys(data[0]).map(k => k.toUpperCase()))
    table.push(...data.map(d => Object.values(d)))
    console.log(table.toString())
  }
}

module.exports = {
  isInteractive,
  relativeTime,
  getSiteDomain,
  showTable,
  cmd,
  demandOption,
  requestOption
}
