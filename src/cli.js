#!/usr/bin/env node
import sanity from "./sanity.js"
import log from "./log.js"
import info from "./info.js"
import upload from "./upload.js"
import invoke from "./invoke.js"
import dotenv from "dotenv"
import path from "path"
//import fs from "fs-extra"

dotenv.config()
const config_file = path.join(process.cwd(), ".severe-extent.cjs")

const json = await import(config_file)
/*
const filename = `${process.cwd()}/.severe-extent.cjs`

let json
try {
  json = await fs.readFile(filename, "utf-8")
} catch (error) {
  console.log(error)
  log("Couldn't find (and/or read) a valid `.severe-extent.cjs` file.")
  process.exit()

*/
console.log(json.default)

const { valid_keys, invalid_keys } = await sanity(json.default)
const [, , ...args] = process.argv

if (!args?.length) {
  if (valid_keys.length) {
    log(`Found valid keys '${valid_keys.join("', '")}'`, "end")
    log(`Run \`severe [key]\` for more info`)
  }

  if (invalid_keys.length) {
    log(
      `Found keys '${invalid_keys.join("', '")}' but the info was invalid`,
      "error"
    )
  }
  process.exit()
}

if (
  invalid_keys.find((k) => {
    return k === args[0]
  })
) {
  log("The function you provided has an invalid config", "error")
  process.exit()
}

if (args?.length === 1) {
  log(`You can run \`severe ${args[0]} info\``)
  log(`You can run \`severe ${args[0]} upload\``)
  log(`You can run \`severe ${args[0]} invoke\``)
  process.exit()
}

if (args[1] === "upload") {
  log("upload")

  let {
    function_name,
    src_files,
    handler,
    statics,
    timeout,
    memory_size,
    exe_env,
    runtime,
    schedule,
    role,
    layer,
    deps
  } = json[args[0]]

  let upload_env_map = {}

  let upload_env = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "aws_s3_bucket"
  ]
  upload_env.forEach((key) => {
    const value = process.env?.[key]
    if (!value) {
      throw new Error(`You're missing an upload_env : ${key}`)
    }
    upload_env_map[key] = value
  })
  upload_env = upload_env_map

  let exe_env_map = {}
  exe_env.forEach((key) => {
    const value = process.env?.[key]
    if (!value) {
      throw new Error(`You're missing an exe_env : ${key}`)
    }
    exe_env_map[key] = value
  })
  exe_env = exe_env_map

  await upload({
    function_name,
    src_files,
    handler,
    statics,
    timeout,
    memory_size,
    upload_env,
    exe_env,
    runtime,
    schedule,
    role,
    layer,
    deps
  })
  process.exit()
}

if (args[1] === "info") {
  let { function_name } = json[args[0]]

  let upload_env = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "aws_s3_bucket"
  ]

  let upload_env_map = {}
  upload_env.forEach((key) => {
    upload_env_map[key] = process.env[key]
  })
  upload_env = upload_env_map

  await info({
    function_name,
    upload_env
  })
}

if (args[1] === "invoke") {
  let { function_name } = json[args[0]]

  let upload_env = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "aws_s3_bucket"
  ]

  let upload_env_map = {}
  upload_env.forEach((key) => {
    upload_env_map[key] = process.env[key]
  })
  upload_env = upload_env_map

  await invoke({
    function_name,
    upload_env
  })
}
