import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { PilotLedger } from './meter.mjs';

export default function metering(pi: ExtensionAPI) {
  if (!process.env.PILOT_LEDGER || !process.env.PILOT_RUN_ID) throw new Error('PILOT_LEDGER and PILOT_RUN_ID required');
  const ledger = new PilotLedger(process.env.PILOT_LEDGER, {
    scope: process.env.PILOT_SCOPE ?? 'suite', scopeCap: Number(process.env.PILOT_SCOPE_CAP ?? 6),
    globalCap: Number(process.env.PILOT_GLOBAL_CAP ?? 10),
  });
  const trace = (type: string, data: object = {}) => {
    if (process.env.PILOT_METER_TRACE) appendFileSync(process.env.PILOT_METER_TRACE,
      JSON.stringify({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6,type,...data})+'\n');
  };
  let payloadBytes = 0, activeId: string | undefined, validModel = false;
  const originalFetch = globalThis.fetch;
  const guardedFetch: typeof fetch = async (url, options) => {
    const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
    if (target.hostname !== 'chatgpt.com' || !target.pathname.includes('/codex/responses')) return originalFetch(url, options);
    if (!validModel) throw new Error('pilot usage limit: default model not verified');
    let actualBytes=payloadBytes;
    if (typeof options?.body==='string') actualBytes=Buffer.byteLength(options.body);
    else if (options?.body instanceof Uint8Array) {
      const compressed=new Headers(options.headers).get('content-encoding')==='zstd';
      actualBytes=compressed?zstdDecompressSync(options.body).byteLength:options.body.byteLength;
    } else throw new Error('pilot usage limit: unmeterable request body');
    const id = ledger.reserve(process.env.PILOT_RUN_ID!,actualBytes); activeId = id;
    trace('http_attempt',{id,payloadBytes:actualBytes});
    try {
      const response = await originalFetch(url,options);
      ledger.status(id,response.status); trace('http_response',{id,status:response.status});
      if (!response.ok) ledger.unknown(id);
      return response;
    } catch (e) { ledger.unknown(id); trace('http_network_error',{id,error:String(e)}); throw e; }
  };
  globalThis.fetch = guardedFetch;
  pi.on('session_start',(_event,ctx)=> {
    validModel=ctx.model?.provider==='openai-codex' && ctx.model?.id==='gpt-6.1-sol';
    trace('resolved_model',{model:ctx.model?.id,provider:ctx.model?.provider,api:ctx.model?.api,nominalTariff:ctx.model?.cost});
    if (ctx.model?.provider !== 'openai-codex' || ctx.model?.id !== 'gpt-6.1-sol')
      trace('unexpected_model',{actual:ctx.model?.id,provider:ctx.model?.provider});
  });
  pi.on('before_provider_request',event=> { payloadBytes = Buffer.byteLength(JSON.stringify(event.payload));
    trace('logical_provider_request',{payloadBytes}); });
  pi.on('provider_stream_event',event=> {
    const data = event.data as any;
    if (['response.completed','response.done','response.incomplete'].includes(data?.type)) {
      if (ledger.settle(activeId,data.response?.id,data.response?.usage))
        trace('usage_settled',{id:activeId,responseId:data.response?.id,rawUsage:data.response?.usage});
    }
  });
  pi.on('message_end',event=> {
    if (event.message.role === 'assistant') trace('pi_message_usage',{
      usage:event.message.usage,stopReason:event.message.stopReason,model:event.message.model,provider:event.message.provider});
  });
  pi.on('session_shutdown',()=> { if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
    if (activeId) ledger.unknown(activeId); ledger.close(); });
}
