import child_process from "child_process"
import os from "os"
import path from "path"
import util from "util"

import {
  LambdaClient,
  GetFunctionCommand,
  DeleteFunctionCommand,
  CreateFunctionCommand,
  AddPermissionCommand
} from "@aws-sdk/client-lambda"

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

import {
  EventBridgeClient,
  ListRuleNamesByTargetCommand,
  ListTargetsByRuleCommand,
  RemoveTargetsCommand,
  PutRuleCommand,
  PutTargetsCommand
} from "@aws-sdk/client-eventbridge"

import fs from "fs-extra"
import terminalKit from "terminal-kit"

import prepareNodeLocally from "./prepare-node-locally.js"

const term = terminalKit.terminal
const exec = util.promisify(child_process.exec)

export default async function ({
  function_name,
  src_files,
  statics = [],
  timeout = 3,
  memory_size = 128,
  upload_env,
  exe_env,
  runtime,
  role,
  schedule = [],
  layer,
  deps = []
}) {
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

  if (function_exists) {
    term(
      "deleting the function because we need to do that first for some reason"
    )

    await lambda_client.send(
      new DeleteFunctionCommand({
        FunctionName: function_name
      })
    )
  }
  progress_bar.update({ progress: 0.1 })

  const build_path = path.join(os.tmpdir(), `${function_name}_build/`)
  const zip_filename = path.join(os.tmpdir(), `${function_name}.zip`)

  progress_bar.update({ title: "cleaning up zip" })
  await fs.remove(zip_filename)

  progress_bar.update({ progress: 0.2 })

  progress_bar.update({ title: "copying static files" })
  for (const static_file of statics) {
    const { base } = path.parse(static_file)
    await fs.copy(static_file, path.join(build_path, base))
  }
  progress_bar.update({ progress: 0.25 })

  if (runtime.indexOf("node") !== -1) {
    progress_bar.update({ progress: 0.28 })
    await prepareNodeLocally(
      { build_path, src_files, deps, exe_env },
      progress_bar
    )
    progress_bar?.update({ progress: 0.35 })
    progress_bar.update({ title: "zipping up build folder" })
    await exec(`zip -r ${zip_filename} .`, {
      cwd: build_path
    })
    progress_bar.update({ progress: 0.4 })
  } else if (runtime.indexOf("python") !== -1) {
    const venv_path = path.join(os.tmpdir(), `${function_name}_venv`)
    progress_bar?.update({ title: "cleaning up old folders" })
    await fs.remove(venv_path)
    await fs.remove(build_path)

    progress_bar?.update({ title: `making build path at ${build_path}` })
    await fs.mkdirp(build_path)

    progress_bar.update({ progress: 0.28 })
    await exec(`python3 -m venv ${venv_path}`)
    for (const [i, dep] of deps.entries()) {
      progress_bar.update({
        title: `installing python dep ${dep}`,
        progress: 0.25 + (i / deps.length) * 0.05
      })
      await exec(`source ${venv_path}/bin/activate && pip3 install ${dep}`)
    }
    progress_bar.update({ progress: 0.3 })

    progress_bar.update({ title: "zipping up python deps" })
    await exec(`zip -r ${zip_filename} .`, {
      cwd: `${venv_path}/lib/python3.9/site-packages`
    })
    progress_bar.update({ progress: 0.35 })

    for (const [i, src_file] of src_files.entries()) {
      progress_bar.update({
        title: `adding python file ${src_file} to zip`,
        progress: 0.35 + (i / src_files.length) * 0.05
      })
      await exec(`zip -g  ${zip_filename} ${src_file}.py`, {
        cwd: "./pysrc"
      })
    }
    progress_bar.update({ progress: 0.4 })
  } else {
    throw new Error("Non-supported runtime")
  }

  progress_bar.update({ title: "uploading zip to s3" })

  const s3_client = new S3Client({
    region: upload_env.aws_region
  })
  await s3_client.send(
    new PutObjectCommand({
      Bucket: upload_env.aws_s3_bucket,
      Key: `${function_name}.zip`,
      Body: fs.createReadStream(zip_filename)
    })
  )
  progress_bar.update({ progress: 0.45 })

  let exe_env_map = {}
  exe_env.forEach((key) => {
    const value = process.env?.[key]
    if (!value) {
      throw new Error(`You're missing an exe_env : ${key}`)
    }
    exe_env_map[key] = value
  })

  progress_bar.update({
    title: "creating lambda function because it doesn't exist"
  })
  await lambda_client.send(
    new CreateFunctionCommand({
      FunctionName: function_name,
      Runtime: runtime,
      Role: role,
      Handler: "lambda/handler.handler",
      Timeout: timeout,
      MemorySize: memory_size,
      Layers: layer ? [layer] : [],
      Environment: {
        Variables: {
          ...exe_env_map,
          ...upload_env
        }
      },
      Code: {
        S3Bucket: upload_env.aws_s3_bucket,
        S3Key: `${function_name}.zip`
      }
    })
  )
  progress_bar.update({ progress: 0.5 })

  progress_bar.update({ title: "fetching lambda function info again" })
  const latest_function_info = await lambda_client.send(
    new GetFunctionCommand({
      FunctionName: function_name
    })
  )
  progress_bar.update({ progress: 0.55 })

  const eventbridge_client = new EventBridgeClient({
    region: upload_env.aws_region
  })

  progress_bar.update({ title: "removing old schedules" })
  let { RuleNames: old_rules } = await eventbridge_client.send(
    new ListRuleNamesByTargetCommand({
      TargetArn: latest_function_info?.Configuration?.FunctionArn
    })
  )

  progress_bar.update({ progress: 0.7 })
  for (const [i, old_rule] of old_rules.entries()) {
    progress_bar.update({ title: `fetching old rule ${old_rule}` })
    const { Targets: all_targets_of_old_rule } = await eventbridge_client.send(
      new ListTargetsByRuleCommand({
        Rule: old_rule
      })
    )

    const targets = all_targets_of_old_rule.filter((t) => {
      return t.Arn === latest_function_info?.Configuration?.FunctionArn
    })
    progress_bar.update({
      title: `removing old rule ${old_rule}`,
      progress: 0.7 + (i / src_files.length) * 0.1
    })
    eventbridge_client.send(
      new RemoveTargetsCommand({
        Ids: targets.map((t) => t.Id),
        Rule: old_rule
      })
    )
  }
  progress_bar.update({ progress: 0.8 })

  for (const [i, s] of schedule.entries()) {
    let expression
    let event_name
    let one_step = 1 / schedule.length
    let schedule_progress = i / schedule.length
    if (s.how_often === "hourly") {
      expression = `cron(${s.at_minute} * ? * * *)`
      event_name = `hourly_at_${s.at_minute}`
    } else if (s.how_often === "daily") {
      expression = `cron(${s.at_minute} ${s.at_hour} ? * * *)`
      event_name = `daily_at_${s.at_hour}_${s.at_minute}`
    }

    progress_bar.update({
      title: `adding new rule ${event_name}`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.3
    })
    const new_rule = await eventbridge_client.send(
      new PutRuleCommand({
        Name: event_name,
        ScheduleExpression: expression
      })
    )

    progress_bar.update({
      title: `granting permissions for rule ${event_name}`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.6
    })
    try {
      await lambda_client.send(
        new AddPermissionCommand({
          Action: "lambda:InvokeFunction",
          FunctionName: function_name,
          Principal: "events.amazonaws.com",
          StatementId: `${event_name}__${function_name}`,
          SourceArn: new_rule.Arn
        })
      )
    } catch (e) {
      // it's ok
    }

    progress_bar.update({
      title: `associating rule ${event_name} with function`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.9
    })
    await eventbridge_client.send(
      new PutTargetsCommand({
        Rule: event_name,
        Targets: [
          {
            Arn: latest_function_info.Configuration.FunctionArn,
            Id: "1"
          }
        ]
      })
    )
  }
  progress_bar.update({ progress: 1 })

  term.clear()
  term(`Uploaded `)
  term.green(function_name)
  term(".\n\n")
}
