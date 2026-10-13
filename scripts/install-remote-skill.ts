import "dotenv/config";
import { ensureRemoteSkill } from "../server/remoteSkill.js";
console.log(JSON.stringify(ensureRemoteSkill(), null, 2));
