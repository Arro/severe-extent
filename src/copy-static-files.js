import fs from "fs-extra"
import path from "path"

export default async function (statics, build_path) {
  console.log("copying static files")
  for (const static_file of statics) {
    console.log(`copying static file ${static_file}`)
    const { base } = path.parse(static_file)

    const is_dir = (await fs.lstat(static_file)).isDirectory()
    console.log(`is_dir ${is_dir}`)
    if (is_dir) {
      const new_path = path.join(build_path, path.basename(static_file))
      await fs.emptyDir(new_path)
      console.log(`copying ${static_file} to ${new_path}`)
      await fs.copy(static_file, new_path)
      const dest_file_exists = await fs.exists(new_path)
      console.log(`does dest folder exist? ${dest_file_exists}`)
    } else {
      await fs.copy(static_file, path.join(build_path, base))
      const dest_file_exists = await fs.exists(path.join(build_path, base))
      console.log(`does dest file exist? ${dest_file_exists}`)
    }
  }
}
