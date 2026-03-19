// https://github.com/aws/aws-sdk-js-v3#functionality-requiring-aws-common-runtime-crt
require('@aws-sdk/signature-v4-crt')

const {
  CloudFrontClient,
  CreateInvalidationForDistributionTenantCommand,
  GetInvalidationForDistributionTenantCommand,
  CreateDistributionTenantCommand,
  UpdateDistributionTenantCommand,
  DeleteDistributionTenantCommand,
  GetDistributionTenantCommand
  // WARNING: you want the KV one, not the CF one! They have different
  // arguments and the CF one returns the wrong ETag (typical)
  // DescribeKeyValueStoreCommand
} = require('@aws-sdk/client-cloudfront')

const {
  CloudFrontKeyValueStoreClient,
  UpdateKeysCommand,
  DescribeKeyValueStoreCommand
} = require('@aws-sdk/client-cloudfront-keyvaluestore')

const logger = require('./logger').getLogger()

const cfClient = new CloudFrontClient()
const kvsClient = new CloudFrontKeyValueStoreClient()

const tenantParams = ({ siteId, enabled, baseDomain, customDomain }) => {
  const params = {
    Enabled: true,
    DistributionId: process.env.DISTRIBUTION_ID,
    Domains: [{ Domain: baseDomain }],
    ConnectionGroupId: process.env.CONNECTION_GROUP_ID,
    Tags: [
      { Name: 'app', Value: process.env.APP_ID },
      { Name: 'stage', Value: process.env.NODE_ENV }
    ],
    Parameters: [
      { Name: 'siteId', Value: siteId }
    ]
  }
  if (enabled !== undefined) params.Enabled = enabled
  if (customDomain) {
    params.Domains.push({ Domain: customDomain })
    params.ManagedCertificateRequest = {
      PrimaryDomainName: customDomain,
      ValidationTokenHost: 'cloudfront'
    }
  }
  return params
}

module.exports.createTenant = async ({ siteId, baseDomain, customDomain }) => {
  const params = {
    ...tenantParams({ siteId, baseDomain, customDomain }),
    Name: siteId
  }
  logger.http(`cloudfront: create tenant ${siteId}`, params)
  const { DistributionTenant, ETag } = await cfClient.send(new CreateDistributionTenantCommand(params))
  return { tenant: DistributionTenant, etag: ETag }
}

module.exports.updateTenant = async ({ tenantId, siteId, enabled, baseDomain, customDomain, etag }) => {
  const params = {
    ...tenantParams({ siteId, enabled, baseDomain, customDomain }),
    Id: tenantId,
    IfMatch: etag
  }
  logger.http(`cloudfront: update tenant ${siteId}`, params)
  const { DistributionTenant, ETag } = await cfClient.send(new UpdateDistributionTenantCommand(params))
  return { tenant: DistributionTenant, etag: ETag }
}

module.exports.getTenant = async (tenantId) => {
  logger.http(`cloudfront: get tenant ${tenantId}`)
  const { DistributionTenant, ETag } = await cfClient.send(new GetDistributionTenantCommand({ Identifier: tenantId }))
  return { tenant: DistributionTenant, etag: ETag }
}

module.exports.deleteTenant = async ({ tenantId, etag }) => {
  logger.http(`cloudfront: delete tenant ${tenantId}`)
  await cfClient.send(new DeleteDistributionTenantCommand({ Id: tenantId, IfMatch: etag }))
}

module.exports.invalidate = async (distributionTenantId) => {
  const params = {
    Id: distributionTenantId,
    InvalidationBatch: {
      Paths: {
        Items: ['/*'],
        Quantity: 1
      },
      CallerReference: new Date().toISOString()
    }
  }
  logger.http(`cloudfront: create invalidation ${distributionTenantId}`)
  const { Invalidation } = await cfClient.send(new CreateInvalidationForDistributionTenantCommand(params))
  return Invalidation
}

module.exports.getInvalidation = async (distributionTenantId, invalidationId) => {
  logger.http(`cloudfront: get invalidation ${distributionTenantId} ${invalidationId}`)
  const { Invalidation } = await cfClient.send(new GetInvalidationForDistributionTenantCommand({
    DistributionTenantId: distributionTenantId,
    Id: invalidationId
  }))
  return Invalidation
}

const updateKVS = async ({ puts, deletes, attempts }) => {
  // we have to look up the arn and etag of the store to update it
  logger.http(`cloudfront: describe key value store ${process.env.KV_STORE_ARN}`)

  const { ETag } = await kvsClient.send(new DescribeKeyValueStoreCommand({
    KvsARN: process.env.KV_STORE_ARN
  }))

  logger.http('cloudfront: update keys', { puts, deletes })
  await kvsClient.send(new UpdateKeysCommand({
    KvsARN: process.env.KV_STORE_ARN,
    IfMatch: ETag,
    Puts: puts,
    Deletes: deletes
  }))
}

module.exports.writeConfig = async (keys, value) => {
  await updateKVS({
    puts: keys.map(k => ({ Key: k, Value: JSON.stringify(value) })),
    deletes: []
  })
}

module.exports.deleteConfig = async (keys) => {
  await updateKVS({
    puts: [],
    deletes: keys.map(k => ({ Key: k }))
  })
}
