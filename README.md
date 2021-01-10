# Severe Extent

(It's a randomly generated codename with no meaning.)

Tools for lambda uploading and logging.

## Usage

```
import { upload } from "severe-extent"
import dotenv from "dotenv"

dotenv.config()
;(async function () {
  await upload({
    function_name: "my-cool-function",
    src_files: ["index"],
    statics: [],
    handler: "index.handler",
    timeout: 60,
    memory_size: 256,
    upload_env: {
      aws_access_key_id: process.env.aws_access_key_id,
      aws_secret_access_key: process.env.aws_secret_access_key,
      aws_region: process.env.aws_region,
      aws_s3_bucket: process.env.aws_s3_bucket
    },
    exe_env: {
      my_cool_env_var: process.env.my_cool_env_var
    }
  })
})()
```
