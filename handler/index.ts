import * as aws from "@pulumi/aws";
import { TABLE_NAME } from "../constants";
import { addEntry, removeEntry, queryConnections, sendWithErrorHandling } from "../utils";

type Message =
  | SubscribeMessage
  | UnsubscribeMessage
  | PublishMessage
  | PingMessage;
type SubscribeMessage = { type: "subscribe"; topics: string[] };
type UnsubscribeMessage = { type: "unsubscribe"; topics: string[] };
type PublishMessage = { type: "publish"; topic: string };
type PingMessage = { type: "ping" };

export async function handleDefault(event: any) {
  const db = process.env[TABLE_NAME]!;
  let message: Message;

  if (!db) {
    return { statusCode: 500, body: "Missing table name" };
  }

  try {
    message = parseEvent(event);
  } catch (e) {
    return { statusCode: 400, body: e instanceof Error ? e.message : e };
  }

  if (message.type === "ping") {
    return { statusCode: 200, body: JSON.stringify({ type: "pong" }) };
  }

  // Once we have a valid message, we can start processing it
  const connectionId = event.requestContext.connectionId;
  const client = new aws.sdk.DynamoDB.DocumentClient();

  if (message.type === "subscribe") {
    await Promise.all(
      message.topics.map((topic) => addEntry(client, db, topic, connectionId))
    );
  } else if (message.type === "unsubscribe") {
    await Promise.all(
      message.topics.map((topic) =>
        removeEntry(client, db, topic, connectionId)
      )
    );
  } else if (message.type === "publish") {
    const { topic } = message;
    const receivers = await queryConnections(client, db, topic);
    const apiClient = new aws.sdk.ApiGatewayManagementApi({
      apiVersion: "2018-11-29",
      endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
    });
    await Promise.all(
      receivers.map((receiver) =>
        sendWithErrorHandling(apiClient, client, db, topic, receiver, event.body)
      )
    );
  }

  return { statusCode: 200, body: JSON.stringify({}) };
}

/**
 * Parse the event body into a Message
 */
function parseEvent(event: any): Message {
  if (!event.body || typeof event.body !== "string") {
    throw new Error("body must be a valid JSON string");
  }
  let json;
  try {
    json = JSON.parse(event.body);
  } catch (e) {
    throw new Error("body must be a valid JSON string");
  }

  if (json.type === "subscribe" || json.type === "unsubscribe") {
    if (!json.topics) {
      throw new Error("Missing topics");
    }
    if (!Array.isArray(json.topics)) {
      throw new Error("topics must be an array");
    }
    return { type: json.type, topics: json.topics };
  }

  if (json.type === "publish") {
    if (!json.topic) {
      throw new Error("Missing topic");
    }
    return { type: "publish", topic: json.topic };
  }

  if (json.type === "ping") {
    return { type: "ping" };
  }

  throw new Error("Invalid message type");
}
