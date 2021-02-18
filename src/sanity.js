export default async function (json) {
  let valid_keys = []
  let invalid_keys = []

  for (const lambda_key in json) {
    const lambda_data = json[lambda_key]
    const necessary_props = [
      "function_name",
      "src_files",
      "handler",
      "upload_env",
      "exe_env",
      "runtime"
    ]
    let is_valid = true
    for (const prop of necessary_props) {
      if (!lambda_data?.[prop]?.length) {
        is_valid = false
      }
    }
    if (is_valid) {
      valid_keys.push(lambda_key)
    } else {
      invalid_keys.push(lambda_key)
    }
  }

  return {
    valid_keys,
    invalid_keys
  }
}
