import os from "os"
import path from "path"

import terminalKit from "terminal-kit"

import prepareNodeLocally from "./prepare-node-locally.js"

const term = terminalKit.terminal

export default async function ({ runtime, function_name, src_files, deps }) {
  if (runtime !== "nodejs14.x") {
    term.clear()
    term("Local run of runtime ")
    term.yellow(runtime)
    term(" not yet implemented.\n\n")
    process.exit()
    return
  }

  await term.spinner("impulse")
  term(" Running function ")
  term.green(function_name)
  term(" locally...\n\n")

  const build_path = path.join(os.tmpdir(), `${function_name}_build/`)

  await prepareNodeLocally({ build_path, src_files, deps })

  const { handler } = await import(`${build_path}/lambda/handler.js`)
  await handler()
}
