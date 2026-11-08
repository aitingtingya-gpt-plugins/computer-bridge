import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {compileMessage} from './semantic.mjs';

const input=createInterface({input:process.stdin,crlfDelay:Infinity});
let compiled=0;
for await(const line of input){
  let request,result;
  try{request=JSON.parse(line);result=compileMessage(request.text,request.id);}
  catch(error){result={id:request?.id??null,formulas:[],errors:[],error:error.message};}
  const cpu=process.cpuUsage();
  result.metrics={rss_bytes:process.memoryUsage().rss,cpu_user_us:cpu.user,cpu_system_us:cpu.system};
  // MathJax's tag-format registries retain a class closing over each fresh TeX
  // instance. Finish the batch before reclaiming the entire private process.
  if(result.formulas.length&&++compiled===256)result.recycle=true;
  if(!process.stdout.write(JSON.stringify(result)+'\n'))await once(process.stdout,'drain');
  if(result.recycle){input.close();process.stdin.destroy();break;}
}
