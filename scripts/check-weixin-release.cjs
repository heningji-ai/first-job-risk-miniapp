const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const officialApiBaseUrl = "https://first-job-risk.jobeyes.com";
const manifestText = fs.readFileSync(path.join(root, "src", "manifest.json"), "utf8");
const apiConfigText = fs.readFileSync(path.join(root, "src", "config", "api.ts"), "utf8");
const requestText = fs.readFileSync(path.join(root, "src", "api", "request.ts"), "utf8");
const appIdMatch = manifestText.match(/"mp-weixin"\s*:\s*\{[\s\S]*?"appid"\s*:\s*"([^"]*)"/);
const appId = appIdMatch?.[1] ?? "";

function assert(condition, message) { if (!condition) throw new Error(`[check:release:weixin] ${message}`); }
assert(/^wx[0-9a-z]{16}$/.test(appId), "manifest mp-weixin.appid must be a real wx AppID");
assert(appId !== "touristappid", "manifest AppID must not be touristappid");
assert(apiConfigText.includes(`const PRODUCTION_API_BASE_URL = "${officialApiBaseUrl}"`), "production API root must be the official HTTPS URL");
assert(!/PRODUCTION_API_BASE_URL\s*=\s*"http:/.test(apiConfigText), "production API root must not use HTTP");
assert(requestText.includes("timeout: 10000"), "uni.request timeout must be 10000ms");

const buildRoot = path.join(root, "dist", "build", "mp-weixin");
const projectConfig = JSON.parse(fs.readFileSync(path.join(buildRoot, "project.config.json"), "utf8"));
assert(projectConfig.appid === appId, "built project.config.json AppID must match manifest");
const forbidden = /localhost|127\.0\.0\.1|http:\/\//i;
const textExtensions = new Set([".js", ".json", ".wxml", ".wxss", ".wxs"]);
for (const entry of fs.readdirSync(buildRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filePath = path.join(entry.parentPath, entry.name);
  if (!textExtensions.has(path.extname(filePath))) continue;
  const content = fs.readFileSync(filePath, "utf8");
  assert(!forbidden.test(content), `build output contains a forbidden development address: ${path.relative(root, filePath)}`);
}
console.log("Weixin release configuration check passed.");
