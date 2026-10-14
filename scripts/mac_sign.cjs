// electron-builder afterSign 钩子：macOS 包由这里签名（package.json 里 mac.identity 设成 null，electron-builder 自己不签）。
// 发版时用固定的自签名证书签：Squirrel.Mac 只要求新版和已装版本的签名出自同一张证书，不要求是 Apple 发的，
// 这样不买开发者证书也能应用内更新。证书从环境变量拿（GitHub Secrets），没有就退回临时签名（本机打包）。
//   MAC_SIGN_P12           证书和私钥导出的 .p12，base64
//   MAC_SIGN_P12_PASSWORD  .p12 的密码
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const IDENTITY = "EasyRead Self-Signed";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
}

// 证书放进一个临时钥匙串，签完删掉；不动系统钥匙串，也不需要把证书设成受信任
function withKeychain(p12Base64, password, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easyread-sign-"));
  const keychain = path.join(dir, "sign.keychain-db");
  const p12 = path.join(dir, "cert.p12");
  const kcPass = Math.random().toString(36).slice(2);
  const searchList = run("security", ["list-keychains", "-d", "user"]).split("\n").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  try {
    fs.writeFileSync(p12, Buffer.from(p12Base64, "base64"));
    run("security", ["create-keychain", "-p", kcPass, keychain]);
    run("security", ["set-keychain-settings", keychain]);
    run("security", ["unlock-keychain", "-p", kcPass, keychain]);
    run("security", ["list-keychains", "-d", "user", "-s", keychain, ...searchList]);
    run("security", ["import", p12, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"]);
    run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", kcPass, keychain]);
    return fn(keychain);
  } finally {
    try { run("security", ["list-keychains", "-d", "user", "-s", ...searchList]); } catch {}
    try { run("security", ["delete-keychain", keychain]); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

exports.default = async function sign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const p12 = process.env.MAC_SIGN_P12;
  if (p12) {
    withKeychain(p12, process.env.MAC_SIGN_P12_PASSWORD || "", keychain =>
      run("codesign", ["--force", "--deep", "--sign", IDENTITY, "--keychain", keychain, app], { stdio: "inherit" }));
  } else {
    if (process.env.CI && process.env.EASYREAD_VALIDATE_UNSIGNED !== "1") throw new Error("MAC_SIGN_P12 未设置：发版的 macOS 包必须用固定证书签名，否则以后没法应用内更新");
    console.log("  • 没有 MAC_SIGN_P12，用临时签名（本机打包；这样的包不能应用内更新）");
    run("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  }
  run("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  run("codesign", ["-d", "-r-", app], { stdio: "inherit" });  // 打出签名要求，发版日志里能核对证书没换
};
