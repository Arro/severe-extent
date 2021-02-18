#!/usr/bin/env node
import fs from "fs-extra"
import sanity from "./sanity"
import log from "./log"
import info from "./info"
import upload from "./upload"
import dotenv from "dotenv"

dotenv.config()
;(async function () {
  const filename = ".severe-extent.json"
  let json
  try {
    json = await fs.readFile(filename, "utf-8")
    json = JSON.parse(json)
  } catch (error) {
    log("Couldn't find (and/or read) a valid `.severe-extent.json` file.")
    return
  }

  const { valid_keys, invalid_keys } = await sanity(json)
  const [, , ...args] = process.argv

  if (!args?.length) {
    if (valid_keys.length) {
      log(`Found valid keys '${valid_keys.join("', '")}'`, "end")
      log(`Run \`severe [key]\` for more info`)
    }

    if (invalid_keys.length) {
      log(
        `Found keys '${valid_keys.join("', '")}' but the info was invalid`,
        "error"
      )
    }
    return
  }

  if (
    invalid_keys.find((k) => {
      return k === args[0]
    })
  ) {
    log("The function you provided has an invalid config", "error")
    return
  }

  if (args?.length === 1) {
    log(`You can run \`severe ${args[0]} upload\``)
    log(`You can run \`severe ${args[0]} run\``)
    return
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
      upload_env,
      exe_env,
      runtime,
      eventbridge_rule,
      role
    } = json[args[0]]

    let upload_env_map = {}
    upload_env.forEach((key) => {
      upload_env_map[key] = process.env[key]
    })
    upload_env = upload_env_map

    let exe_env_map = {}
    exe_env.forEach((key) => {
      exe_env_map[key] = process.env[key]
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
      eventbridge_rule,
      role
    })
    return
  }

  if (args[1] === "info") {
    let { function_name, upload_env } = json[args[0]]

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

  if (args[1] === "run") {
    let { handler } = json[args[0]]
    let func_name = "default"
    if (handler.indexOf(".") !== -1) {
      ;[handler, func_name] = handler.split(".")
    }

    log(`would be running func ${handler}.${func_name} but not implemented yet`)
    return
  }
})()
