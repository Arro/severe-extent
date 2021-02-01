import _upload from "./upload"
import _log from "./log"
import _sanity from "./sanity"

export async function upload(args) {
  return await _upload(args)
}

export function log(message, type) {
  return _log(message, type)
}

export function sanity() {
  return _sanity()
}
