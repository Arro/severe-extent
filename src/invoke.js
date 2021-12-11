import AWS from "aws-sdk"
import terminalKit from "terminal-kit"

const term = terminalKit.terminal

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

  term.clear()
  term("Invoking ")
  term.green(function_name)
  term(" ")
  await term.spinner("impulse")
  term("\n\n")

  try {
    await lambda
      .invokeAsync({
        FunctionName: function_name,
        InvokeArgs: "{}"
      })
      .promise()
  } catch (e) {
    term.red("There was an error while invoking\n\n")
    console.log(e)
    return
  }
  term.clear()
  term(`Invoked `)
  term.green(function_name)
  term(".\n\n")
  process.exit()
}
