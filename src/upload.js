import child_process from "child_process"
import os from "os"
import path from "path"
import util from "util"

import AWS from "aws-sdk"
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

  AWS.config.update({
    accessKeyId: upload_env.aws_access_key_id,
    secretAccessId: upload_env.aws_secret_access_key,
    region: upload_env.aws_region
  })

  const lambda = new AWS.Lambda({
    apiVersion: "2015-03-31"
  })

  let progress_bar = term.progressBar({
    width: 120,
    titleSize: 50,
    title: "checking if lambda function exists",
    eta: true,
    percent: true
  })
  let current_function_info
  let function_exists

  try {
    current_function_info = await lambda
      .getFunction({
        FunctionName: function_name
      })
      .promise()
    function_exists = true
  } catch (e) {
    function_exists = false
  }
  progress_bar.update({ progress: 0.05 })

  if (function_exists) {
    const aws_runtime = current_function_info?.Configuration?.Runtime
    const region =
      current_function_info?.Configuration?.FunctionArn?.split(":")?.[3]
    let delete_first = false
    if (aws_runtime !== runtime) {
      term(
        `there's a runtime mismatch (provided '${runtime}' versus on AWS '${aws_runtime}')`
      )
      term("let's delete the function and remake it with the right runtime")
      delete_first = true
    }
    if (region !== upload_env.aws_region) {
      term(
        `there's a region mismatch (provided '${upload_env.aws_region}' versus on AWS '${region}')`
      )
      term("let's delete the function and remake it with the right region")
      delete_first = true
    }

    if (delete_first) {
      progress_bar.update({
        title: "deleting lambda function containing wrong runtime"
      })
      await lambda
        .deleteFunction({
          FunctionName: function_name
        })
        .promise()
      function_exists = false
    }
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
  const S3 = new AWS.S3({
    apiVersion: "2006-03-01"
  })
  await S3.upload({
    Bucket: upload_env.aws_s3_bucket,
    Key: `${function_name}.zip`,
    Body: fs.createReadStream(zip_filename)
  }).promise()
  progress_bar.update({ progress: 0.45 })

  let exe_env_map = {}
  exe_env.forEach((key) => {
    const value = process.env?.[key]
    if (!value) {
      throw new Error(`You're missing an exe_env : ${key}`)
    }
    exe_env_map[key] = value
  })

  if (!function_exists) {
    progress_bar.update({
      title: "creating lambda function because it doesn't exist"
    })
    await lambda
      .createFunction({
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
      .promise()
    progress_bar.update({ progress: 0.5 })
  } else {
    progress_bar.update({ title: "updating lambda because it already existed" })

    await lambda
      .updateFunctionCode({
        FunctionName: function_name,
        S3Bucket: upload_env.aws_s3_bucket,
        S3Key: `${function_name}.zip`
      })
      .promise()

    await lambda
      .updateFunctionConfiguration({
        FunctionName: function_name,
        Handler: "lambda/handler.handler",
        Timeout: timeout,
        MemorySize: memory_size,
        Layers: layer ? [layer] : [],
        Role: role,
        Environment: {
          Variables: {
            ...exe_env_map,
            ...upload_env
          }
        }
      })
      .promise()
    progress_bar.update({ progress: 0.5 })
  }

  progress_bar.update({ title: "fetching lambda function info again" })
  const latest_function_info = await lambda
    .getFunction({
      FunctionName: function_name
    })
    .promise()
  progress_bar.update({ progress: 0.55 })

  var eventbridge = new AWS.EventBridge({ apiVersion: "2015-10-07" })

  progress_bar.update({ title: "removing old schedules" })
  let { RuleNames: old_rules } = await eventbridge
    .listRuleNamesByTarget({
      TargetArn: latest_function_info?.Configuration?.FunctionArn
    })
    .promise()

  progress_bar.update({ progress: 0.7 })
  for (const [i, old_rule] of old_rules.entries()) {
    progress_bar.update({ title: `fetching old rule ${old_rule}` })
    const { Targets: all_targets_of_old_rule } = await eventbridge
      .listTargetsByRule({
        Rule: old_rule
      })
      .promise()

    const targets = all_targets_of_old_rule.filter((t) => {
      return t.Arn === latest_function_info?.Configuration?.FunctionArn
    })
    progress_bar.update({
      title: `removing old rule ${old_rule}`,
      progress: 0.7 + (i / src_files.length) * 0.1
    })
    eventbridge
      .removeTargets({
        Ids: targets.map((t) => t.Id),
        Rule: old_rule
      })
      .promise()
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
    const new_rule = await eventbridge
      .putRule({
        Name: event_name,
        ScheduleExpression: expression
      })
      .promise()

    progress_bar.update({
      title: `granting permissions for rule ${event_name}`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.6
    })
    try {
      await lambda
        .addPermission({
          Action: "lambda:InvokeFunction",
          FunctionName: function_name,
          Principal: "events.amazonaws.com",
          StatementId: `${event_name}__${function_name}`,
          SourceArn: new_rule.Arn
        })
        .promise()
    } catch (e) {
      // it's ok
    }

    progress_bar.update({
      title: `associating rule ${event_name} with function`,
      progress: 0.8 + schedule_progress * 0.2 + one_step * 0.9
    })
    await eventbridge
      .putTargets({
        Rule: event_name,
        Targets: [
          {
            Arn: latest_function_info.Configuration.FunctionArn,
            Id: "1"
          }
        ]
      })
      .promise()
  }
  progress_bar.update({ progress: 1 })

  term.clear()
  term(`Uploaded `)
  term.green(function_name)
  term(".\n\n")
}
