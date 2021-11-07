import AWS from "aws-sdk"

import log from "./log.js"

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

  log(`Invoking ${function_name}`, "start")
  try {
    const data = await lambda
      .invokeAsync({
        FunctionName: function_name,
        InvokeArgs: "{}"
      })
      .promise()
    console.log(data)
  } catch (e) {
    log("There was an error while invoking", "error")
    console.log(e)
    return
  }
  log(`Invoked ${function_name}`, "end")
}
