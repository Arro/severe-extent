import AWS from "aws-sdk"

import log from "./log"

export default async function ({ function_name, upload_env }) {
  const req_keys = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "aws_s3_bucket"
  ]
  for (const key of req_keys) {
    if (!upload_env[key]) {
      throw new Error(`You didn't include ${key} in upload_env`)
    }
  }

  AWS.config.update({
    accessKeyId: upload_env.aws_access_key_id,
    secretAccessId: upload_env.aws_secret_access_key,
    region: upload_env.aws_region
  })

  const lambda = new AWS.Lambda({
    apiVersion: "2015-03-31"
  })

  log("pulling function config from AWS", "start")
  let function_info

  try {
    function_info = await lambda
      .getFunction({
        FunctionName: function_name
      })
      .promise()
  } catch (e) {
    log("lambda function doesn't exist on AWS", "error")
    return
  }
  log("pulled function config from AWS:", "end")

  console.log(JSON.stringify(function_info?.Configuration, null, 2))

  var eventbridge = new AWS.EventBridge({ apiVersion: "2015-10-07" })
  const buses = await eventbridge.listEventBuses({}).promise()
  const bus = buses?.EventBuses?.find((b) => {
    return b.Name === "default"
  })

  log("pulling eventbridge rules from AWS", "start")
  const rules = await eventbridge
    .listRuleNamesByTarget({
      EventBusName: bus.Arn,
      TargetArn: function_info?.Configuration?.FunctionArn
    })
    .promise()
  log("pulled eventbridge rules from AWS", "end")

  for (const rule_name of rules?.RuleNames) {
    const rule = await eventbridge
      .describeRule({
        EventBusName: bus.Arn,
        Name: rule_name
      })
      .promise()
    console.log(JSON.stringify(rule, null, 2))
  }
}
