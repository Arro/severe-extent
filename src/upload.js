import child_process from "child_process"
import os from "os"
import path from "path"
import util from "util"

import {
  LambdaClient,
  GetFunctionCommand,
  DeleteFunctionCommand,
  CreateFunctionCommand,
  AddPermissionCommand,
  CreateEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  DeleteEventSourceMappingCommand
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

import {
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  DeleteQueueCommand
} from "@aws-sdk/client-sqs"

import fs from "fs-extra"
import terminalKit from "terminal-kit"

import copyStaticFiles from "./copy-static-files.js"
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
  source_queue_name,
  destination_queue_name,
  deps = []
}) {
  term.clear()
  term("Uploading lambda function ")
  term.green(function_name)
  term(" ")
  await term.spinner("impulse")
  term("\n\n")

  const sqs_client = new SQSClient({ region: upload_env.aws_region })
  if (destination_queue_name) {
    try {
      const { QueueUrl: destination_queue_url } = await sqs_client.send(
        new GetQueueUrlCommand({ QueueName: destination_queue_name })
      )

      term(`Destination queue ${destination_queue_name} exists, deleting it\n`)
      await sqs_client.send(
        new DeleteQueueCommand({ QueueUrl: destination_queue_url })
      )
      term(`Waiting 70 seconds\n`)
      await new Promise(function (resolve) {
        setTimeout(resolve, 70_000)
      })
    } catch (e) {
      // no problem, nothing to delete
    }

    term(`Creating destination queue ${destination_queue_name}\n`)
    await sqs_client.send(
      new CreateQueueCommand({
        QueueName: destination_queue_name,
        Attributes: {
          VisibilityTimeout: timeout * 6,
          FifoQueue: true
        }
      })
    )
  }

  const lambda_client = new LambdaClient({ region: upload_env.aws_region })

  /*
  let progress_bar = term.progressBar({
    width: 120,
    titleSize: 50,
    title: "checking if lambda function exists",
    eta: true,
    percent: true
  })
  */

  console.log("checking if lambda function exists")

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
  //progress_bar.update({ progress: 0.05 })

  if (function_exists) {
    console.log("deleting old event source mappings\n")
    const { EventSourceMappings: previous_event_source_mappings } =
      await lambda_client.send(
        new ListEventSourceMappingsCommand({
          FunctionName: function_name
        })
      )
    term(JSON.stringify(previous_event_source_mappings, null, 2) + "\n")

    for (const previous_event_source_mapping of previous_event_source_mappings) {
      term(
        `deleting previous event source mapping ${previous_event_source_mapping.UUID}\n`
      )
      await lambda_client.send(
        new DeleteEventSourceMappingCommand({
          UUID: previous_event_source_mapping.UUID
        })
      )
      term(`Waiting 30 seconds\n`)
      await new Promise(function (resolve) {
        setTimeout(resolve, 30_000)
      })
    }

    term(
      "deleting the function because we need to do that first for some reason\n"
    )

    await lambda_client.send(
      new DeleteFunctionCommand({
        FunctionName: function_name
      })
    )
  }
  //progress_bar.update({ progress: 0.1 })

  const build_path = path.join(os.tmpdir(), `${function_name}_build/`)
  const zip_filename = path.join(os.tmpdir(), `${function_name}.zip`)

  //progress_bar.update({ title: "cleaning up zip" })
  await fs.remove(zip_filename)

  //progress_bar.update({ progress: 0.2 })

  if (runtime.indexOf("node") !== -1) {
    //progress_bar.update({ progress: 0.28 })
    await prepareNodeLocally(
      { build_path, src_files, deps, exe_env }
      //progress_bar
    )
    await copyStaticFiles(statics, build_path)

    //progress_bar?.update({ progress: 0.35 })
    //progress_bar.update({ title: "zipping up build folder" })
    await exec(`zip -r ${zip_filename} .`, {
      cwd: build_path
    })
    //progress_bar.update({ progress: 0.4 })
  } else if (runtime.indexOf("python") !== -1) {
    const venv_path = path.join(os.tmpdir(), `${function_name}_venv`)
    //progress_bar?.update({ title: "cleaning up old folders" })
    console.log("cleaning up old folders")
    await fs.remove(venv_path)
    await fs.remove(build_path)

    //progress_bar?.update({ title: `making build path at ${build_path}` })
    console.log(`making build path at ${build_path}`)
    await fs.mkdirp(build_path)

    //progress_bar.update({ progress: 0.28 })
    await exec(`python3 -m venv ${venv_path}`)

    //for (const [i, dep] of deps.entries()) {
    for (const dep of deps) {
      console.log(`installing python dep ${dep}`)
      /*
      progress_bar.update({
        title: `installing python dep ${dep}`,
        progress: 0.25 + (i / deps.length) * 0.05
      })
      */
      await exec(`. ./bin/activate && pip3 install ${dep}`, {
        cwd: venv_path
      })
    }
    //progress_bar.update({ progress: 0.3 })
    await copyStaticFiles(statics, build_path)

    //progress_bar.update({ title: "zipping up python deps" })
    console.log("zipping up python deps")
    await exec(`zip -r ${zip_filename} .`, {
      cwd: `${venv_path}/lib/python3.10/site-packages`
    })
    //progress_bar.update({ progress: 0.35 })

    //for (const [i, src_file] of src_files.entries()) {
    for (const src_file of src_files) {
      /*
      progress_bar.update({
        title: `adding python file ${src_file} to zip`,
        progress: 0.35 + (i / src_files.length) * 0.05
      })
      */
      console.log(`adding python file ${src_file} to zip`)
      await exec(`zip -g  ${zip_filename} ${src_file}.py`, {
        cwd: "./pysrc"
      })
    }
    //progress_bar.update({ progress: 0.4 })
  } else {
    throw new Error("Non-supported runtime")
  }

  //progress_bar.update({ title: "uploading zip to s3" })
  console.log("uploading zip to s3")
  console.log(`s3 bucket region is: ${upload_env.aws_s3_bucket_region}`)

  const s3_client = new S3Client({
    region: upload_env.aws_s3_bucket_region
  })
  await s3_client.send(
    new PutObjectCommand({
      Bucket: upload_env.aws_s3_bucket,
      Key: `${function_name}.zip`,
      Body: fs.createReadStream(zip_filename)
    })
  )
  //progress_bar.update({ progress: 0.45 })

  let exe_env_map = {}
  exe_env.forEach((key) => {
    const value = process.env?.[key]
    if (!value) {
      throw new Error(`You're missing an exe_env : ${key}`)
    }
    exe_env_map[key] = value
  })

  /*
  progress_bar.update({
    title: "creating lambda function because it doesn't exist"
  })
  */
  console.log("creating lambda function because it doesn't exist")
  await lambda_client.send(
    new CreateFunctionCommand({
      FunctionName: function_name,
      Runtime: runtime,
      Role: role,
      Handler:
        runtime.indexOf("node") !== -1
          ? "lambda/handler.handler"
          : "lambda_function.lambda_handler",
      Timeout: timeout,
      MemorySize: memory_size,
      Layers: layer ? [layer] : [],
      Environment: {
        Variables: {
          ...exe_env_map,
          ...upload_env,
          ...(destination_queue_name && { destination_queue_name }),
          ...(source_queue_name && { source_queue_name })
        }
      },
      Code: {
        S3Bucket: upload_env.aws_s3_bucket,
        S3Key: `${function_name}.zip`
      }
    })
  )
  //progress_bar.update({ progress: 0.5 })

  //progress_bar.update({ title: "fetching lambda function info again" })
  console.log("fetching lambda function info again")
  const latest_function_info = await lambda_client.send(
    new GetFunctionCommand({
      FunctionName: function_name
    })
  )
  //progress_bar.update({ progress: 0.55 })

  const eventbridge_client = new EventBridgeClient({
    region: upload_env.aws_region
  })

  //progress_bar.update({ title: "removing old schedules" })
  console.log("removing old schedules")
  let { RuleNames: old_rules } = await eventbridge_client.send(
    new ListRuleNamesByTargetCommand({
      TargetArn: latest_function_info?.Configuration?.FunctionArn
    })
  )

  //progress_bar.update({ progress: 0.7 })
  //for (const [i, old_rule] of old_rules.entries()) {
  for (const old_rule of old_rules) {
    //progress_bar.update({ title: `fetching old rule ${old_rule}` })
    console.log(`fetching old rule ${old_rule}`)
    const { Targets: all_targets_of_old_rule } = await eventbridge_client.send(
      new ListTargetsByRuleCommand({
        Rule: old_rule
      })
    )

    const targets = all_targets_of_old_rule.filter((t) => {
      return t.Arn === latest_function_info?.Configuration?.FunctionArn
    })
    /*
    progress_bar.update({
      title: `removing old rule ${old_rule}`,
      progress: 0.7 + (i / src_files.length) * 0.1
    })
    */
    console.log(`removing old rule ${old_rule}`)
    eventbridge_client.send(
      new RemoveTargetsCommand({
        Ids: targets.map((t) => t.Id),
        Rule: old_rule
      })
    )
  }
  //progress_bar.update({ progress: 0.8 })

  //for (const [i, s] of schedule.entries()) {
  for (const s of schedule) {
    let expression
    let event_name
    //let one_step = 1 / schedule.length
    //let schedule_progress = i / schedule.length
    if (s.how_often === "hourly") {
      expression = `cron(${s.at_minute} * ? * * *)`
      event_name = `${function_name}_hourly_at_${s.at_minute}`
    } else if (s.how_often === "daily") {
      expression = `cron(${s.at_minute} ${s.at_hour} ? * * *)`
      event_name = `${function_name}_daily_at_${s.at_hour}_${s.at_minute}`
    }

    /*
    progress_bar.update({
      title: `adding new rule ${event_name}`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.3
    })
    */
    console.log(`adding new rule ${event_name}`)
    const new_rule = await eventbridge_client.send(
      new PutRuleCommand({
        Name: event_name,
        ScheduleExpression: expression
      })
    )

    /*
    progress_bar.update({
      title: `granting permissions for rule ${event_name}`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.6
    })
    */
    console.log(`granting permissions for rule ${event_name}`)
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

    /*
    progress_bar.update({
      title: `associating rule ${event_name} with function`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.9
    })
    */
    console.log(`associating rule ${event_name} with function`)
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
  //progress_bar.update({ progress: 1 })
  //progress_bar.stop()
  await new Promise(function (resolve) {
    setTimeout(resolve, 1000)
  })
  term.clear()

  if (source_queue_name) {
    const { QueueUrl: source_queue_url } = await sqs_client.send(
      new GetQueueUrlCommand({ QueueName: source_queue_name })
    )
    term(`\nsource_queue_url: ${source_queue_url}\n`)
    const source_queue_attributes = await sqs_client.send(
      new GetQueueAttributesCommand({
        QueueUrl: source_queue_url,
        AttributeNames: ["QueueArn"]
      })
    )

    await lambda_client.send(
      new CreateEventSourceMappingCommand({
        BatchSize: 1,
        EventSourceArn: source_queue_attributes.Attributes.QueueArn,
        FunctionName: function_name
      })
    )
  }

  term(`Uploaded `)
  term.green(function_name)
  term(".\n\n")
}
