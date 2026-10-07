// Provider-only experiment: no change to the conversation or notification semantics.
// https://developers.openai.com/api/docs/guides/prompt-caching
export function stableCache(payload) {
  const input=payload.input;
  if(!Array.isArray(input))throw new Error('Responses input must be an array');
  const dynamic=input.findIndex(item=>Array.isArray(item.content)&&item.content.some(part=>part.text?.startsWith('<runtime_notifications>\n## Notifications')));
  const boundary=dynamic<0?input.length:dynamic;
  const candidates=[];
  for(let i=0;i<boundary;i++){
    const item=input[i];
    const field=item.type==='function_call_output'?'output':item.role?'content':null;
    if(!field)continue;
    if(typeof item[field]==='string')item[field]=[{type:'input_text',text:item[field]}];
    if(!Array.isArray(item[field]))continue;
    for(const part of item[field])if(part.type==='input_text'){
      delete part.prompt_cache_breakpoint;
      candidates.push({index:i,part});
    }
  }
  // Keep the initial instruction boundary and recent history endpoints, so the
  // preceding request's cache endpoint remains eligible on the next request.
  const selected=[...new Set([candidates[0],...candidates.slice(-3)].filter(Boolean))];
  for(const {part}of selected)part.prompt_cache_breakpoint={mode:'explicit'};
  payload.prompt_cache_options={mode:'explicit'};
  return {mode:'explicit',boundary,breakpointIndexes:selected.map(c=>c.index)};
}
