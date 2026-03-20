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

const { ACMClient, ListCertificatesCommand } = require('@aws-sdk/client-acm')

const logger = require('./logger').getLogger()

const cfClient = new CloudFrontClient()
const kvsClient = new CloudFrontKeyValueStoreClient()

const tenantParams = ({ siteId, baseDomain, customDomain }) => {
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
  if (customDomain) {
    params.Domains.push({ Domain: customDomain })
    params.ManagedCertificateRequest = {
      PrimaryDomainName: customDomain,
      ValidationTokenHost: 'cloudfront'
    }
  }
  return params
}

const createTenant = async ({ siteId, baseDomain, customDomain }) => {
  const params = {
    ...tenantParams({ siteId, baseDomain, customDomain }),
    Name: siteId
  }
  logger.http(`cloudfront: create tenant ${siteId}`, params)
  const { DistributionTenant, ETag } = await cfClient.send(new CreateDistributionTenantCommand(params))
  return { tenant: DistributionTenant, etag: ETag }
}

const getTenant = async (tenantId) => {
  logger.http(`cloudfront: get tenant ${tenantId}`)
  const { DistributionTenant, ETag } = await cfClient.send(new GetDistributionTenantCommand({ Identifier: tenantId }))
  return { tenant: DistributionTenant, etag: ETag }
}

const withProperETag = async ({ tenantId, etag }, operationFn) => {
  try {
    return await operationFn(etag)
  } catch (err) {
    // could be the etag is invalid. Try grabbing and trying again
    const res = await getTenant(tenantId)
    return await operationFn(res.etag)
  }
}

const setCustomDomain = async ({ siteId, tenantId, etag, baseDomain, customDomain }) => {
  return withProperETag({ tenantId, etag }, async (etag) => {
    logger.http(`cloudfront: update tenant ${tenantId}`)
    const { DistributionTenant, ETag } = await cfClient.send(new UpdateDistributionTenantCommand({
      ...tenantParams({ siteId, baseDomain, customDomain }),
      Id: tenantId,
      IfMatch: etag
    }))
    // TODO: try and find cert immediately?
    return { tenant: DistributionTenant, etag: ETag }
  })
}

const removeCustomDomain = async ({ siteId, tenantId, etag, baseDomain }) => {
  return await setCustomDomain({ siteId, tenantId, etag, baseDomain, customDomain: null })
}

// Search for an Issued certificate matching the domain manged by cloudfront
const findCloudfrontCertificateMatching = async (domain) => {
  // find a certificate for the domain
  const acm = new ACMClient()
  let NextToken
  let pendingCert = null
  while (true) {
    const res = await acm.send(new ListCertificatesCommand({
      CertificateStatuses: ['PENDING_VALIDATION', 'ISSUED'],
      Includes: { managedBy: 'CLOUDFRONT' },
      SortBy: 'CREATED_AT',
      SortOrder: 'DESCENDING',
      MaxItems: 1000,
      NextToken
    }))
    for (const cert of res.CertificateSummaryList) {
      if (cert.DomainName !== domain) continue

      if (cert.Status === 'ISSUED') {
        return { certificateArn: cert.CertificateArn, isIssued: true }
      }
      // hold onto it but keep looking for an issued one
      if (cert.Status === 'PENDING_VALIDATION' && !pendingCert) pendingCert = cert
    }
    if (!res.NextToken || res.CertificateSummaryList.length === 0) break
    NextToken = res.NextToken
  }
  if (pendingCert) {
    return { certificateArn: pendingCert.CertificateArn, isIssued: false }
  }

  return null
}

const attachCertificate = async ({ tenantId, etag, certificateArn }) => {
  return withProperETag({ tenantId, etag }, async (etag) => {
    logger.http(`cloudfront: disable tenant ${tenantId}`)
    const { DistributionTenant, ETag } = await cfClient.send(new UpdateDistributionTenantCommand({
      Id: tenantId,
      IfMatch: etag,
      Customizations: {
        Certificate: {
          Arn: certificateArn
        }
      }
    }))
    return { tenant: DistributionTenant, etag: ETag }
  })
}

const disableTenant = async ({ tenantId, etag }) => {
  return withProperETag({ tenantId, etag }, async (etag) => {
    logger.http(`cloudfront: disable tenant ${tenantId}`)
    const { DistributionTenant, ETag } = await cfClient.send(new UpdateDistributionTenantCommand({
      Id: tenantId,
      IfMatch: etag,
      Enabled: false
    }))
    return { tenant: DistributionTenant, etag: ETag }
  })
}

const deleteTenant = async ({ tenantId, etag }) => {
  return await withProperETag({ tenantId, etag }, async (etag) => {
    logger.http(`cloudfront: delete tenant ${tenantId}`)
    await cfClient.send(new DeleteDistributionTenantCommand({ Id: tenantId, IfMatch: etag }))
  })
}

const invalidate = async (distributionTenantId) => {
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

const getInvalidation = async (distributionTenantId, invalidationId) => {
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

const writeConfig = async (keys, value) => {
  await updateKVS({
    puts: keys.map(k => ({ Key: k, Value: JSON.stringify(value) })),
    deletes: []
  })
}

const deleteConfig = async (keys) => {
  await updateKVS({
    puts: [],
    deletes: keys.map(k => ({ Key: k }))
  })
}

module.exports = {
  createTenant,
  getTenant,
  setCustomDomain,
  removeCustomDomain,
  findCloudfrontCertificateMatching,
  attachCertificate,
  disableTenant,
  deleteTenant,
  invalidate,
  getInvalidation,
  writeConfig,
  deleteConfig
}
