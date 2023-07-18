import * as aws from "@pulumi/aws";

type DocumentClient = InstanceType<typeof aws.sdk.DynamoDB.DocumentClient>;
type ApiGateway = InstanceType<typeof aws.sdk.ApiGatewayManagementApi>;

/**
 * Adds an entry from the DynamoDB table
 * @param client a DynamoDB DocumentClient
 * @param tableName the name of the DynamoDB table
 * @param topic the topic to add. Forms the composite key with connectionId
 * @param connectionId the connectionId to add. Forms the composite key with topic
 * @returns a promise that resolves when the entry has been added
 */
export async function addEntry(
  client: DocumentClient,
  tableName: string,
  topic: string,
  connectionId: string
) {
  return await client
    .put({
      TableName: tableName,
      Item: { topicName: topic, clientId: connectionId },
    })
    .promise();
}

/**
 * Removes an entry from the DynamoDB table
 * @param client a DynamoDB DocumentClient
 * @param tableName the name of the DynamoDB table
 * @param topic the topic to remove. Forms the composite key with connectionId
 * @param connectionId the connectionId to remove. Forms the composite key with topic
 * @returns a promise that resolves when the entry has been removed
 */
export async function removeEntry(
  client: DocumentClient,
  tableName: string,
  topic: string,
  connectionId: string
) {
  return await client
    .delete({
      TableName: tableName,
      Key: { topicName: topic, clientId: connectionId },
    })
    .promise();
}

/**
 * Returns a list of connectionIds for the given topic
 * @param client a DynamoDB DocumentClient
 * @param tableName the name of the DynamoDB table
 * @param topic the topic to query
 * @returns a promise that resolves to a list of connectionIds
 */
export async function queryConnections(
  client: DocumentClient,
  tableName: string,
  topic: string
): Promise<string[]> {
  const data = await client
    .query({
      TableName: tableName,
      KeyConditionExpression: "topicName = :topicName",
      ExpressionAttributeValues: {
        ":topicName": topic,
      },
      ConsistentRead: true,
    })
    .promise();
  return data.Items?.map(({ clientId }: any) => clientId) || [];
}

/**
 * Returns a list of topics for the given connectionId
 * @param client the DynamoDB DocumentClient
 * @param tableName the name of the DynamoDB table
 * @param connectionId the connectionId to query
 * @returns a promise that resolves to a list of topics
 */
export async function queryTopics(
  client: DocumentClient,
  tableName: string,
  connectionId: string,
): Promise<string[]> {
  const data = await client
    .query({
      TableName: tableName,
      KeyConditionExpression: "clientId = :clientId",
      ExpressionAttributeValues: {
        ":clientId": connectionId,
      },
    })
    .promise();
  return data.Items?.map(({ topicName }: any) => topicName) || [];
}

/**
 * Send a message to a connectionId, removing the entry if the connectionId is no longer valid
 * @param apiClient the ApiGatewayManagementApi client
 * @param dbClient the DynamoDB DocumentClient
 * @param tableName the name of the DynamoDB table
 * @param topic the topic we are sending to
 * @param connectionId the connectionId we are sending to
 * @param data the data to send
 * @returns 
 */
export async function sendWithErrorHandling(
  apiClient: ApiGateway,
  dbClient: DocumentClient,
  tableName: string,
  topic: string,
  connectionId: string,
  data: string
) {
  try {
    return await send(apiClient, connectionId, data);
  } catch (e) {
    if (isAWSError(e) && e.statusCode === 410) {
      await removeEntry(dbClient, tableName, topic, connectionId);
    } else {
      console.log(`Failed to publish message to ${connectionId}`);
    }
  }
  return;
}

/**
 * Send a message to a connectionId
 * @param apiClient the ApiGatewayManagementApi client
 * @param connectionId the connectionId we are sending to
 * @param data the data to send
 * @returns a promise that resolves when the message has been sent
 */
export async function send(
  apiClient: ApiGateway,
  connectionId: string,
  data: string
) {
  return await apiClient
    .postToConnection({ ConnectionId: connectionId, Data: data })
    .promise();
}

/**
 * A type guard to check if an error is an AWS error
 */
export function isAWSError(e: any): e is { statusCode: number; message: string } {
  return e && "statusCode" in e && "message" in e;
}
