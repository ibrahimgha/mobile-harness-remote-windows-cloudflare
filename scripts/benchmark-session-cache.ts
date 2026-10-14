import { performance } from "node:perf_hooks";
import { parseSessionFile, sessionParseCacheStats, clearSessionCache } from "../server/codexSessions.js";
const file=process.argv[2];if(!file)throw Error("Supply one transcript path (read-only benchmark)");
const times:number[]=[];
for(let i=0;i<4;i++){
 clearSessionCache(); // Simulate the heartbeat invalidations seen in production.
 const start=performance.now();await parseSessionFile(file,new Map(),{maxTailBytes:768*1024});times.push(performance.now()-start);
}
console.log(JSON.stringify({scope:"single-file summary parse, 768 KiB tail; not an end-to-end service latency measurement",coldMs:+times[0].toFixed(2),warmMs:times.slice(1).map(t=>+t.toFixed(2)),cache:sessionParseCacheStats(),historyWrites:0}));
