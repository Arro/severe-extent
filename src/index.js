import _upload from "./upload.js"
import _log from "./log.js"
import _sanity from "./sanity.js"

export async function upload(args) {
  return await _upload(args)
}

export function log(message, type) {
  return _log(message, type)
}

export function sanity() {
  return _sanity()
}
