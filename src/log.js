import ora from "ora"

let spinner
// type is one of "start", "end", "normal"
export default function (message, type) {
  if (!process.env.AWS_EXECUTION_ENV?.startsWith("AWS")) {
    if (!spinner) {
      spinner = ora("Starting up").start()
    }
    if (type === "start") {
      spinner.start(message)
    } else if (type === "end") {
      spinner.succeed(message)
    } else if (type === "error") {
      spinner.fail(message)
    } else {
      spinner.info(message)
    }
  } else {
    if (type === "start") {
      console.log("⋯ " + message)
    } else if (type === "end") {
      console.log("✔ " + message)
    } else {
      console.log("ℹ " + message)
    }
  }
}
