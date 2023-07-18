import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { TABLE_NAME } from "./constants";
import { handleDefault } from "./handler";
import { handleDisconnect } from "./disconnectHandler";

const db = new aws.dynamodb.Table("topics", {
  attributes: [
    { name: "topicName", type: "S" },
    { name: "clientId", type: "S" },
  ],
  hashKey: "topicName",
  rangeKey: "clientId",
  readCapacity: 5,
  writeCapacity: 5,
  globalSecondaryIndexes: [{
    hashKey: "clientId",
    name: "clientIdIndex",
    nonKeyAttributes: ["topicName"],
    projectionType: "INCLUDE",
    readCapacity: 5,
    writeCapacity: 5,
  }]
});

const api = new aws.apigatewayv2.Api("api", {
  protocolType: "WEBSOCKET",
  routeSelectionExpression: "$request.body.action",
});

const lambdaRole = new aws.iam.Role("handlerRole", {
  assumeRolePolicy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "",
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com"
        },
        Action: "sts:AssumeRole"
      }
    ]
  })
});

const lambdaRolePolicy = new aws.iam.RolePolicy("handlerRolePolicy", {
  role: lambdaRole,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"],
        Resource: pulumi.interpolate`${db.arn}/*`,
      },
      {
        Effect: "Allow",
        Action: ["execute-api:ManageConnections"],
        Resource: pulumi.interpolate`${api.executionArn}/*`
      },
    ],
  }),
});

const handler = new aws.lambda.CallbackFunction("handler", {
  callback: handleDefault,
  role: lambdaRole,
  environment: {
    variables: {
      [TABLE_NAME]: db.name,
    }
  }
});

const disconnectHandler = new aws.lambda.CallbackFunction("disconnectHandler", {
  callback: handleDisconnect,
  role: lambdaRole,
  environment: {
    variables: {
      [TABLE_NAME]: db.name,
    }
  }
});


const defaultIntegration = new aws.apigatewayv2.Integration(
  "defaultIntegration",
  {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: handler.invokeArn,
    contentHandlingStrategy: "CONVERT_TO_TEXT",
  }
);

const disconnectIntegration = new aws.apigatewayv2.Integration(
  "disconnectIntegration",
  {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: disconnectHandler.invokeArn,
    contentHandlingStrategy: "CONVERT_TO_TEXT",
  }
);

const defaultRoute = new aws.apigatewayv2.Route("defaultRoute", {
  apiId: api.id,
  routeKey: "$default",
  target: pulumi.interpolate`integrations/${defaultIntegration.id}`,
});

const disconnectRoute = new aws.apigatewayv2.Route("disconnectRoute", {
  apiId: api.id,
  routeKey: "$disconnect",
  target: pulumi.interpolate`integrations/${disconnectIntegration.id}`,
});

const deployment = new aws.apigatewayv2.Deployment(
  "deployment",
  { apiId: api.id },
  { dependsOn: [defaultRoute, disconnectRoute] }
);

const stage = new aws.apigatewayv2.Stage("stage", {
  apiId: api.id,
  name: "dev",
  deploymentId: deployment.id,
});

export const url = pulumi.interpolate`${api.apiEndpoint}/${stage.name}`;
