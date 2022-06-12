import {
  LambdaClient,
  GetFunctionCommand,
  DeleteFunctionCommand
} from "@aws-sdk/client-lambda"
import terminalKit from "terminal-kit"

const term = terminalKit.terminal

export default async function ({ function_name, upload_env }) {
  term.clear()
  term("Uploading lambda function ")
  term.green(function_name)
  term(" ")
  await term.spinner("impulse")
  term("\n\n")

  const lambda_client = new LambdaClient({ region: upload_env.aws_region })

  let progress_bar = term.progressBar({
    width: 120,
    titleSize: 50,
    title: "checking if lambda function exists",
    eta: true,
    percent: true
  })
  let function_exists

  try {
    await lambda_client.send(
      new GetFunctionCommand({
        FunctionName: function_name
      })
    )
    function_exists = true
  } catch (e) {
    function_exists = false
  }
  progress_bar.update({ progress: 0.05 })

  if (!function_exists) {
    term(`function ${function_name} does not exist, exiting...\n\n`)
  }

  progress_bar.update({
    title: "deleting lambda function"
  })
  await lambda_client.send(
    new DeleteFunctionCommand({
      FunctionName: function_name
    })
  )
  progress_bar.update({ progress: 1 })

  term.clear()
  term(`Deleted `)
  term.green(function_name)
  term(".\n\n")
}
