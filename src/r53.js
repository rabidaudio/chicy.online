const {
  Route53Client,
  ChangeResourceRecordSetsCommand
} = require('@aws-sdk/client-route-53')

const logger = require('./logger').getLogger()

const client = new Route53Client()

module.exports.getSiteDomain = (siteId) => `${siteId}.${process.env.SITES_DOMAIN}`

const getSiteRecordSet = (siteId) => ({
  Name: this.getSiteDomain(siteId),
  Type: 'CNAME',
  TTL: 300,
  ResourceRecords: [
    { Value: process.env.DISTRIBUTION_DOMAIN }
  ]
})

const changeResource = async (operation, siteId) => {
  const params = {
    HostedZoneId: process.env.HOSTED_ZONE_ID,
    ChangeBatch: {
      Comment: `${operation} ${siteId}`,
      Changes: [
        {
          Action: operation,
          ResourceRecordSet: getSiteRecordSet(siteId)
        }
      ]
    }
  }
  logger.http(`route53: ${operation} ${siteId}`)
  const { Id, Status } = await client.send(new ChangeResourceRecordSetsCommand(params))
  return { Id, Status }
}

module.exports.createSubdomain = async (siteId) => changeResource('UPSERT', siteId)

module.exports.deleteSubdomain = async (siteId) => changeResource('DELETE', siteId)
