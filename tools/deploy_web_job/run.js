var os = require("os")
var fs = require("fs")
var path = require("path")
var archiver = require("archiver")
var exec = require("child_process").exec
var randomstring = require("randomstring")

function usage() {
  console.log("node run.js <path_to_package> --job-type=[continuous|triggered] " +
              "--job-name=<job_name> --site-name=<website_name>")
}

function processArgs(argv) {
  var args = require("minimist")(argv)
  var required_args = ["job-type", "job-name", "site-name"]
  for (arg of required_args) {
    if (!(arg in args)) {
      console.log("missing arg: " + arg)
      usage()
      process.exit(1)
    }
  }
  return args;
}

function shell(cmd, args, cb) {

  console.log("\n" + cmd + " " + args.join(" "))

  // Would rather use spawn here but on Windows spawn wont start a
  // .cmd (which is what the azure cli is).
  // This'll run the Windows version of azure.cmd, not any npm
  // installed version, btw.

  var shell = exec(cmd + " " + args.join(" "))
  shell.stdout.on("data", (data) => {
    process.stdout.write(`${data}`);
  });
  shell.stderr.on("data", (data) => {
    console.log(`exec stderr: ${data}`);
  });
  shell.on("close", (code) => {
    cb(code)
  });
}

function main(argv) {

  /* This is all tediously necessary since npm@3 now flattens
   * node_modules which is good news for Windows users but makes
   * creating the package zip file for a web job that much
   * more labourious (since we can't just npm install the package
   * locally install, zip and upload)
   */

  var args = processArgs(argv.slice(2))

  // Get package files
  var packageDir = args["_"][0]
  var packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf-8")
  )
  var files = packageJson.files

  var packageFile = path.join(os.tmpdir(), randomstring.generate() + '.zip')
  console.log("Creating package file: " + packageFile)

  var output = fs.createWriteStream(packageFile)
  var archive = archiver('zip')

  archive.on("end", function(err, result) {

    console.log("done")

    var cmd = "azure"
    var _args = [
      "site", "job", "upload", "--job-type=" + args["job-type"],
      "--job-name=" + args["job-name"], "--job-file=" + packageFile,
      args["site-name"]
    ]

    shell(cmd, _args, (exitCode) => {
      if (exitCode != 0) {
        process.exit(2);
      }
      else {
        process.exit(0);
      }
    });
  });

  archive.pipe(output)
  for (file of files) {
    let filePath = path.join(packageDir, file);
    if (fs.statSync(filePath).isDirectory()) {
      archive.directory(filePath, {name:file});
    }
    else {
      archive.file(filePath, {name:file})
    }
  }
  archive.directory(path.join(packageDir, "node_modules"), "node_modules")
  archive.finalize()
}

if (require.main === module) {
    main(process.argv);
}
