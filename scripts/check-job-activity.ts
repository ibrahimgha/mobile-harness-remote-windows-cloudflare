import assert from "node:assert/strict";
import { activeChatIdsForRevalidation, confirmedActiveJobVersions, isConfirmedActiveJob } from "../src/jobActivity.js";
const old={id:"old",chatId:"unselected",status:"running",startedAt:"2026-10-01T00:00:00Z"};
assert.equal(isConfirmedActiveJob({...old,activityUnverified:true}),false,"restored hints must not display as live");
assert.equal(isConfirmedActiveJob(old),true,"age alone must never hide a genuine running job");
for(const status of ["completed","failed","stopped"]){
 const terminal={...old,status};
 assert.deepEqual(confirmedActiveJobVersions([old,terminal]),[]);
 assert.deepEqual(confirmedActiveJobVersions([terminal,old]),[],"stale refresh cannot resurrect terminal status");
}
assert.deepEqual(confirmedActiveJobVersions([old,{...old,activityUnverified:true}]),[old],"cache hints cannot override a confirmed server job");
assert.deepEqual(confirmedActiveJobVersions([{...old,activityUnverified:true},old]),[old]);
assert.deepEqual(activeChatIdsForRevalidation({unselected:[{...old,activityUnverified:true}],queued:[{...old,chatId:"queued",status:"queued"}],done:[{...old,status:"completed"}]}),["unselected","queued"]);
assert.equal(isConfirmedActiveJob({...old,status:"queued"}),true);
assert.equal(confirmedActiveJobVersions([{...old,status:"steered"},{...old,status:"queued"}])[0].status,"queued","unconfirmed steering can legitimately return to the queue");
console.log("PASS: restored hints, real long-running jobs, terminal precedence, deduplication and unselected-chat revalidation.");
