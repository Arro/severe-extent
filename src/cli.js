#!/usr/bin/env node
import sanity from "./sanity.js"
import info from "./info.js"
import upload from "./upload.js"
import invoke from "./invoke.js"
import dotenv from "dotenv"
import path from "path"

import terminalKit from "terminal-kit"
import paginatedMenu from "#src/paginated-menu.js"

const term = terminalKit.terminal

dotenv.config()
const config_file = path.join(process.cwd(), ".severe-extent.cjs")

const json = await import(config_file)

term.on("key", function (name) {
  if (name === "CTRL_C") {
    process.exit()
  }
})

term.clear()
term("\n")
term.bgWhite.black(
  "                        Severe Extent                       "
)
const menu_items = [
  {
    name: "Check config file sanity",
    command: "sanity"
  },
  {
    name: "Upload a lambda function",
    command: "upload"
  },
  {
    name: "Get info on a lamdba function",
    command: "info"
  },
  {
    name: "Invoke a lambda function",
    command: "invoke"
  },
  {
    name: "Run a lambda handler, but locally",
    command: "run_local"
  }
]

term("\n\n")
await term(`How do you want to procede?`)
term("\n")
const choice = await paginatedMenu(menu_items, (m) => m.name)

if (choice.command === "sanity") {
  const { valid_keys, invalid_keys } = await sanity(json.default)
  term.clear()
  if (valid_keys.length) {
    term(`Found valid keys '${valid_keys.join("', '")}'\n\n`)
  }
  if (invalid_keys.length) {
    term(
      `Found keys '${invalid_keys.join("', '")}' but the info was invalid\n\n`
    )
  }
  process.exit()
}

term.clear()
term("\n\n")
await term(`What lambda function?`)
term("\n")

const func = await paginatedMenu(
  Object.values(json.default),
  (f) => f.function_name
)

if (choice.command === "upload") {
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
  } = func

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

if (choice.command === "info") {
  term("\n\n")
  term(func)
  term("\n\n")
  let { function_name } = func

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

if (choice.command === "invoke") {
  let { function_name } = func

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
