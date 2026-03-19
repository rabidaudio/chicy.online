const winston = require('winston')

const isInteractive = require('is-interactive').default()

const errorFormatter = winston.format((info, _opts) => {
  if (info instanceof Error || info.stack) {
    return { ...info, message: (info.message || '') + '\n' + info.stack }
  }
  return info
})

let formats = [
  errorFormatter(),
  winston.format.simple()
]
if (isInteractive) {
  formats = [
    winston.format.colorize({
      level: true,
      colors: {
        error: 'bgRed',
        warn: 'bgYellow',
        info: 'blue',
        http: 'gray',
        verbose: 'magenta'
      }
    }),
    ...formats
  ]
}

const _logger = winston.createLogger({
  levels: winston.config.npm.levels,
  format: winston.format.combine(...formats),
  level: 'warn',
  transports: []
})

module.exports.configure = ({ level } = {}) => {
  _logger.level = level
  _logger.add(
    new winston.transports.Console({
      stderrLevels: ['info', 'http', 'verbose']
    })
  )
  return this
}

module.exports.getLogger = () => {
  return _logger
}
