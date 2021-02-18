import child_process from "child_process"
import os from "os"
import path from "path"
import util from "util"

import AWS from "aws-sdk"
import fs from "fs-extra"

const exec = util.promisify(child_process.exec)

import log from "./log"

export default async function ({
  function_name,
  src_files,
  handler = "index.handler",
  statics = [],
  timeout = 3,
  memory_size = 128,
  upload_env,
  exe_env,
  runtime,
  role,
  eventbridge_rule
}) {
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

  log("checking if lambda function exists", "start")
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
  log(`checking if lambda function exists: ${function_exists}`, "end")

  if (function_exists) {
    const aws_runtime = current_function_info?.Configuration?.Runtime
    if (aws_runtime !== runtime) {
      log(
        `there's a runtime mismatch (provided '${runtime}' versus on AWS '${aws_runtime}')`
      )
      log("let's delete the function and remake it with the right runtime")

      log("deleting lambda function containing wrong runtime", "start")
      await lambda
        .deleteFunction({
          FunctionName: function_name
        })
        .promise()
      log("deleted lambda function containing wrong runtime", "end")
      function_exists = false
    }
  }

  const build_path = path.join(os.tmpdir(), `${function_name}_build/`)
  const zip_filename = path.join(os.tmpdir(), `${function_name}.zip`)

  log(`making build path at ${build_path}`, "start")
  await fs.mkdirp(build_path)
  log(`made build path at ${build_path}`, "end")

  log("copying static files", "start")
  for (const static_file of statics) {
    const { base } = path.parse(static_file)
    await fs.copy(static_file, path.join(build_path, base))
  }
  log("copied static files", "end")

  log("copying package.json", "start")
  await fs.copy("package.json", path.join(build_path, "package.json"))
  log("copied package.json", "end")

  log("installing node.js packages", "start")
  await exec("npm install --production --no-package-lock", {
    cwd: build_path
  })
  log("installed node.js packages", "end")

  log("generating src files with babel", "start")
  for (const src_file of src_files) {
    await exec(`npx babel src/${src_file}.js --out-dir ${build_path}`)
  }
  log(`generated ${src_files.length} src files with babel`, "end")

  log("zipping up build folder", "start")
  await exec(`zip -r ${zip_filename} .`, {
    cwd: build_path
  })
  log("zipping up build folder", "end")

  log("uploading zip to s3", "start")

  const S3 = new AWS.S3({
    apiVersion: "2006-03-01"
  })
  await S3.upload({
    Bucket: upload_env.aws_s3_bucket,
    Key: `${function_name}.zip`,
    Body: fs.createReadStream(zip_filename)
  }).promise()

  log("uploaded zip to s3", "end")

  if (!function_exists) {
    log("creating lambda function because it doesn't exist", "start")
    await lambda
      .createFunction({
        FunctionName: function_name,
        Runtime: runtime,
        Role: role,
        Handler: handler,
        Timeout: timeout,
        MemorySize: memory_size,
        Environment: {
          Variables: {
            ...exe_env
          }
        },
        Code: {
          S3Bucket: upload_env.aws_s3_bucket,
          S3Key: `${function_name}.zip`
        }
      })
      .promise()
    log("created lambda function because it didn't exist", "end")
  } else {
    log("updating lambda because it already existed", "start")

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
        Handler: handler,
        Timeout: timeout,
        MemorySize: memory_size,
        Role: role,
        Environment: {
          Variables: {
            ...exe_env
          }
        }
      })
      .promise()
    log("updated lambda because it already existed", "end")
  }

  if (eventbridge_rule) {
    log("associationg eventbridge rule", "start")

    const latest_function_info = await lambda
      .getFunction({
        FunctionName: function_name
      })
      .promise()

    var eventbridge = new AWS.EventBridge({ apiVersion: "2015-10-07" })
    const buses = await eventbridge.listEventBuses({}).promise()
    const bus = buses?.EventBuses?.find((b) => {
      return b.Name === "default"
    })

    await eventbridge
      .putTargets({
        EventBusName: bus.Arn,
        Rule: eventbridge_rule,
        Targets: [
          {
            Arn: latest_function_info.Configuration.FunctionArn,
            Id: eventbridge_rule
          }
        ]
      })
      .promise()

    log("associationg eventbridge rule", "end")
  }
}
