const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb')

const client = new DynamoDBClient()
const docClient = DynamoDBDocumentClient.from(client)

exports.createUser = async (user) => {
    const command = new PutCommand({
        TableName: process.env.USERS_TABLE,
        Item: user
    })
    await docClient.send(command)
    return user
}

exports.getUser = async (userId) => {
    const command = new GetCommand({
        TableName: process.env.USERS_TABLE,
        Key: { userId }
    })
    const { Item } = await docClient.send(command)
    return Item
}
