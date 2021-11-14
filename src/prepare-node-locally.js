import child_process from "child_process"
import path from "path"
import util from "util"

import fs from "fs-extra"

const exec = util.promisify(child_process.exec)

export default async function ({ build_path, src_files, deps }, progress_bar) {
  progress_bar?.update({ title: "cleaning up old folders" })
  await fs.remove(build_path)

  progress_bar?.update({ title: `making build path at ${build_path}` })
  await fs.mkdirp(build_path)

  deps = [...deps, "core-js", "dotenv", "fs-extra"]
  await fs.mkdir(path.join(build_path, "lambda"))
  await fs.writeFile(
    path.join(build_path, "lambda", "package.json"),
    "{}",
    "utf-8"
  )

  const handler_text = `
      exports.handler = async (event, context) => {
        const { handler } = await import('../${src_files[0]}.js');
        return await handler(event, context)
      }
    `
  await fs.writeFile(
    path.join(build_path, "lambda", "handler.js"),
    handler_text,
    "utf-8"
  )

  await fs.writeFile(
    path.join(build_path, "package.json"),
    `{"type": "module"}`,
    "utf-8"
  )

  for (const [i, dep] of deps.entries()) {
    progress_bar?.update({
      title: `installing nodejs dep ${dep}`,
      progress: 0.25 + (i / deps.length) * 0.05
    })
    await exec(`npm install --only=prod --no-package-lock --prefix ./ ${dep}`, {
      cwd: build_path
    })
  }
  progress_bar?.update({ progress: 0.3 })

  for (const [i, src_file] of src_files.entries()) {
    progress_bar?.update({
      title: `generating src file with babel: ${src_file}`,
      progress: 0.3 + (i / src_files.length) * 0.05
    })
    await exec(`npx babel src/${src_file}.js --out-dir ${build_path}`)
  }
}
