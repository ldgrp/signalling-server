import * as aws from "@pulumi/aws";
import { TABLE_NAME } from "../constants";
import { queryTopics, removeEntry } from "../utils";

/**
 * Handles a websocket disconnect
 * This is a best-effort implementation. If the connection is lost before the
 * disconnect message is sent, the client will not be removed from the topic.
 * @param event 
 * @returns 
 */
export async function handleDisconnect(event: any) {
  const db = process.env[TABLE_NAME]!;

  const connectionId = event.requestContext.connectionId;
  const client = new aws.sdk.DynamoDB.DocumentClient();

  const topics = await queryTopics(client, db, connectionId);

  await Promise.all(
    topics.map((topic) => removeEntry(client, db, topic, connectionId))
  );

  return { statusCode: 200 };
}
