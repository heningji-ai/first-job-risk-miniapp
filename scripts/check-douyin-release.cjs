const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestText = fs.readFileSync(path.join(root, "src", "manifest.json"), "utf8");
const appIdMatch = manifestText.match(/"mp-toutiao"\s*:\s*\{[\s\S]*?"appid"\s*:\s*"([^"]*)"/);
const appId = appIdMatch?.[1] ?? "";

function assert(condition, message) { if (!condition) throw new Error(`[check:release:douyin] ${message}`); }
assert(/^tt[0-9a-z]{18}$/.test(appId), "manifest mp-toutiao.appid must be a real tt AppID");
assert(!["testAppId", "touristappid", ""].includes(appId), "manifest AppID must not be a test, tourist, or empty value");
assert(/"name"\s*:\s*"初入职场预演"/.test(manifestText), "manifest product name must be 初入职场预演");

const buildRoot = path.join(root, "dist", "build", "mp-toutiao");
const projectConfig = JSON.parse(fs.readFileSync(path.join(buildRoot, "project.config.json"), "utf8"));
assert(projectConfig.appid === appId, "built project.config.json AppID must match manifest");
assert(projectConfig.projectname === "初入职场预演", "built project name must be 初入职场预演");
const forbidden = /localhost|127\.0\.0\.1|http:\/\//i;
const textExtensions = new Set([".js", ".json", ".ttml", ".ttss", ".wxml", ".wxss", ".wxs"]);
for (const entry of fs.readdirSync(buildRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filePath = path.join(entry.parentPath, entry.name);
  if (!textExtensions.has(path.extname(filePath))) continue;
  assert(!forbidden.test(fs.readFileSync(filePath, "utf8")), `build output contains a forbidden development address: ${path.relative(root, filePath)}`);
}
console.log("Douyin release configuration check passed.");
