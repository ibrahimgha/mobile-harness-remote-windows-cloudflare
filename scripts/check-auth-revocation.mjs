import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const failures = [];

if (
  !/response\.status === 401[\s\S]{0,320}localStorage\.removeItem\(tokenKey\)[\s\S]{0,180}setAuthenticated\(false\)/.test(
    source
  )
) {
  failures.push("Rejected authenticated API requests must erase the saved token and leave the authenticated UI.");
}

if (!/Authentication expired\. Enter the current control token\./.test(source)) {
  failures.push("Token revocation must explain why the Unlock screen returned.");
}

if (!/verifiesStoredToken[\s\S]{0,760}localStorage\.removeItem\(tokenKey\)[\s\S]{0,100}setLoginToken\(""\)/.test(source)) {
  failures.push("A rejected saved token must be removed instead of remaining prefilled on Unlock.");
}

if (!/nextSocket\.addEventListener\("close"[\s\S]{0,420}void loadState\(\);[\s\S]{0,100}scheduleReconnect\(\)/.test(source)) {
  failures.push("A rejected socket reconnect must promptly verify HTTP authentication instead of showing stale content.");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Authentication revocation checks passed.");
