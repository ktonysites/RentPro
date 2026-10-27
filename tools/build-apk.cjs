// Builds the Android APK with Gradle and copies it to dist/RentPro.apk.
// Uses Android Studio's bundled JDK and the default SDK location unless JAVA_HOME / ANDROID_HOME are set.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const isWindows = process.platform === "win32";

const javaHome = process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)
  ? process.env.JAVA_HOME
  : (isWindows ? "C:\\Program Files\\Android\\Android Studio\\jbr" : "/Applications/Android Studio.app/Contents/jbr/Contents/Home");
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  (isWindows ? path.join(os.homedir(), "AppData", "Local", "Android", "Sdk") : path.join(os.homedir(), "Library", "Android", "sdk"));

for (const [label, dir] of [["JDK", javaHome], ["Android SDK", sdk]]) {
  if (!fs.existsSync(dir)) { console.error(`${label} not found at ${dir}. Set JAVA_HOME / ANDROID_HOME.`); process.exit(1); }
}
fs.writeFileSync(path.join(ANDROID, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`);

const release = process.argv.includes("--release");
const task = release ? "assembleRelease" : "assembleDebug";
console.log(`Building ${task} with JDK ${javaHome}`);
// Full quoted path: cmd.exe does not always search the working directory, and the project path may contain spaces.
execFileSync(isWindows ? `"${path.join(ANDROID, "gradlew.bat")}"` : "./gradlew", [task, "--console=plain"], {
  cwd: ANDROID,
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ...javaTempEnv() }
});

// JDK 21 on Windows opens a Unix-domain socket in TEMP for Gradle's internal wake-up pipe. A short 8.3 TEMP path
// (C:\Users\ADMINI~1\...) makes that fail with "Unable to establish loopback connection", so give Java a plain folder.
function javaTempEnv() {
  if (!isWindows) return {};
  const dir = path.join(os.homedir(), ".gradle", "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const flag = `-Djdk.net.unixdomain.tmpdir="${dir}" -Djava.io.tmpdir="${dir}"`;
  return { TEMP: dir, TMP: dir, JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, flag].filter(Boolean).join(" ") };
}

const variant = release ? "release" : "debug";
const built = path.join(ANDROID, "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
const out = path.join(ROOT, "dist", "RentPro.apk");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);
console.log(`APK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
