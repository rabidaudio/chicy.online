const path = require('node:path')

const serverless = require('serverless-http')

const logger = require('./src/logger').configure({ level: 'verbose', pretty: false }).getLogger()

const { app } = require('./src/server')
const Deployments = require('./src/deployments')

exports.apiHandler = serverless(app)

exports.deployHandler = async (event, _context) => {
  logger.http('s3 event', event)
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

    if (path.extname(key) === '.promote') {
      await Deployments.promote({ promoteKey: key })
    } else {
      await Deployments.process({ tarballPath: key })
    }
  }
}
