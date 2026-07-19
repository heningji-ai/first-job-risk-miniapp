const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const officialApiBaseUrl = "https://first-job-risk.jobeyes.com";
const manifestText = fs.readFileSync(path.join(root, "src", "manifest.json"), "utf8");
const apiConfigText = fs.readFileSync(path.join(root, "src", "config", "api.ts"), "utf8");
const appIdMatch = manifestText.match(/"mp-xhs"\s*:\s*\{[\s\S]*?"appid"\s*:\s*"([^"]*)"/);
const appId = appIdMatch?.[1] ?? "";

function assert(condition, message) { if (!condition) throw new Error(`[check:release:xhs] ${message}`); }
assert(/^[0-9a-z]{24}$/.test(appId), "manifest mp-xhs.appid must be a real XHS AppID");
assert(!["testAppId", "touristappid", "", "placeholder"].includes(appId), "manifest AppID must not be test, tourist, placeholder, or empty");
assert(/"name"\s*:\s*"初入职场预演"/.test(manifestText), "manifest product name must be 初入职场预演");
assert(apiConfigText.includes(`const PRODUCTION_API_BASE_URL = "${officialApiBaseUrl}"`), "production API root must be the official HTTPS URL");

const buildRoot = path.join(root, "dist", "build", "mp-xhs");
const projectConfig = JSON.parse(fs.readFileSync(path.join(buildRoot, "project.config.json"), "utf8"));
assert(projectConfig.appid === appId, "built project.config.json AppID must match manifest");
assert(projectConfig.projectname === "初入职场预演", "built project name must be 初入职场预演");
const forbidden = /testAppId|touristappid|localhost|127\.0\.0\.1|http:\/\//i;
const textExtensions = new Set([".js", ".json", ".wxml", ".wxss", ".wxs"]);
for (const entry of fs.readdirSync(buildRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filePath = path.join(entry.parentPath, entry.name);
  if (!textExtensions.has(path.extname(filePath))) continue;
  assert(!forbidden.test(fs.readFileSync(filePath, "utf8")), `build output contains forbidden value: ${path.relative(root, filePath)}`);
}
console.log("XHS release configuration check passed.");
