import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {appendFileSync} from 'node:fs';
export default function offline(pi:ExtensionAPI){
 const original=globalThis.fetch;let call=0;
 globalThis.fetch=async(url,options)=>{const target=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);if(target.hostname==='127.0.0.1')return original(url,options);if(target.hostname!=='chatgpt.com')throw new Error('Offline network denied '+target.hostname);call++;appendFileSync(process.env.NOTES_OFFLINE_TRACE!,JSON.stringify({call,externalNetwork:false})+'\n');
 const methods=[['ci_status',{after:0}],['ci_submit',{suite:'storage'}],['ci_details',{jobId:'offline-job'}],['ci_status',{after:1}]],tool=methods[call-1],id='offline-'+call;
 const item=tool?{type:'function_call',id,call_id:'call-'+call,name:tool[0],arguments:JSON.stringify(tool[1])}:{type:'message',id,role:'assistant',status:'completed',content:[{type:'output_text',text:'offline complete',annotations:[]}]};
 const events=[{type:'response.created',response:{id:'response-'+call,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:tool?{...item,arguments:''}:{...item,content:[]}}];
 if(tool)events.push({type:'response.function_call_arguments.delta',output_index:0,delta:item.arguments});else events.push({type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'offline complete'});
 events.push({type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response-'+call,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:20}}}});
 return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});
 };
 pi.on('session_shutdown',()=>{globalThis.fetch=original;});
}
