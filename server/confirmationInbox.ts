import type { ConfirmationTable } from "./confirmationTable.js";

export function startConfirmationInbox(table:ConfirmationTable,baseUrl:string,token:string) {
  let busy=false,stopped=false;
  async function poll() {
    if(busy||stopped)return;
    busy=true;
    try {
      for(const row of table.decisions()) {
        if(stopped)break;
        try {
          const response=await fetch(`${baseUrl}/api/chats/${encodeURIComponent(String(row.cid))}/confirmation`,{
            method:'POST',headers:{'content-type':'application/json','x-control-token':token},
            body:JSON.stringify({id:row.id,action:row.choice===1?'accept':'dismiss'}),signal:AbortSignal.timeout(15000)
          });
          if(response.ok)table.set(String(row.cid),String(row.id),row.choice===1?'accepted':'dismissed');
          else if(response.status===404||response.status===409)table.set(String(row.cid),String(row.id),'closed');
          else console.error('Acknowledgment delivery:',response.status);
        } catch(error) {console.error('Acknowledgment delivery:',error instanceof Error?error.message:String(error));}
      }
    } finally {busy=false;}
  }
  const tick=()=>void poll().catch(error=>console.error('Acknowledgment poll:',error));
  const timer=setInterval(tick,2000);timer.unref();tick();
  return ()=>{stopped=true;clearInterval(timer);};
}
