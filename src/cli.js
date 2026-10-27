import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Pipeline } from "./pipeline.js";
import { yesterday, assertDay } from "./time.js";

const config=loadConfig();const command=process.argv[2]||"doctor";
const option=name=>{const match=process.argv.find(x=>x.startsWith(`${name}=`));if(match)return match.slice(name.length+1);const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;};
const day=option("--date")||yesterday(new Date(),config.timezone);
assertDay(day);
const store=new Store(config.dataDir);const pipeline=new Pipeline({config,store});
try{
  if(command==="doctor")console.log(JSON.stringify(await pipeline.doctor(),null,2));
  else{
    let remote;
    try{const r=await fetch(`http://127.0.0.1:${config.port}/api/status`,{signal:AbortSignal.timeout(1000)});const data=await r.json();if(data.service==="InfoLark")remote=data;}catch{}
    if(remote){const action=command==="publish"&&process.argv.includes("--send")?"deliver":command;const r=await fetch(`http://127.0.0.1:${config.port}/api/run`,{method:"POST",headers:{"Content-Type":"application/json","X-InfoLark-Control":remote.control},body:JSON.stringify({action,day,collect:!process.argv.includes("--no-collect"),refresh:process.argv.includes("--refresh")})});const data=await r.json();if(!r.ok)throw new Error(data.error);console.log(JSON.stringify(data,null,2));}
    else{const release=store.lock();try{
      if(command==="collect")console.log(await pipeline.collector.collect(day));
      else if(command==="preview"){const result=await pipeline.preview(day,{collect:!process.argv.includes("--no-collect"),refresh:process.argv.includes("--refresh")});console.log(JSON.stringify({day,items:result.report.items.length,file:store.run(day).markdownPath},null,2));}
      else if(command==="publish")console.log(await pipeline.publish(day,{send:process.argv.includes("--send"),late:true}));
      else throw new Error("可用命令：doctor、collect、preview、publish");
    }finally{release();}}
  }
}catch(error){console.error(error.message);process.exitCode=1;}
