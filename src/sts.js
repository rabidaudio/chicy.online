const {
  STSClient,
  AssumeRoleCommand
} = require('@aws-sdk/client-sts')

const logger = require('./logger').getLogger()

const client = new STSClient()

module.exports.getTemporaryCredentials = async ({ path, deploymentId }) => {
  const arn = `arn:aws:s3:::${process.env.BUCKET_NAME}${new URL(path).pathname}`
  // pending_deployments

  const policy = {
    Version: '2012-10-17',
    Id: 'GrantPutDeploymentTarball',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:PutObject'],
        Resource: arn
      }
    ]
  }
  const params = {
    DurationSeconds: 900, // minimum
    RoleArn: process.env.S3_PUT_ROLE_ARN,
    RoleSessionName: deploymentId,
    Policy: JSON.stringify(policy)
  }
  logger.http(`sts: assume role ${process.env.S3_PUT_ROLE_ARN}: ${path}`)
  const { Credentials } = await client.send(new AssumeRoleCommand(params))
  return {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
    expiresAt: Credentials.Expiration
  }
}
