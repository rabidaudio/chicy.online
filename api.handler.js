const serverless = require('serverless-http')

require('./src/logger').configure({ level: 'verbose' })

const { app } = require('./src/server')

exports.apiHandler = serverless(app)
