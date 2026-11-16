import { AutoProcessor, AutoModelForVision2Seq, load_image, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true;
const MODEL = 'HuggingFaceTB/SmolVLM-256M-Instruct';
let processorPromise, modelPromise, modelDevice='wasm';
async function getModel() {
  processorPromise ||= AutoProcessor.from_pretrained(MODEL, { progress_callback: p => self.postMessage({status:'progress', ...p}) });
  if (!modelPromise) {
    let adapter = null;
    try { adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter() : null; } catch {}
    modelDevice = adapter ? 'webgpu' : 'wasm';
    modelPromise = AutoModelForVision2Seq.from_pretrained(MODEL, {
      dtype: adapter ? 'fp32' : 'q8',
      device: modelDevice,
      progress_callback: p => self.postMessage({status:'progress', ...p})
    }).catch(error => { modelPromise = null; throw error; });
    if (!adapter) self.postMessage({status:'loading', data:'GPU indisponible : utilisation du processeur (peut être plus lente).'});
  }
  return Promise.all([processorPromise, modelPromise]);
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') { await getModel(); self.postMessage({status:'ready', backend:modelDevice}); return; }
    if (data.type !== 'generate') return;
    const [processor, model] = await getModel();
    const messages = [{role:'user',content:[...(data.data.image?[{type:'image',image:data.data.image}]:[]),{type:'text',text:data.data.prompt}]}];
    const images = data.data.image ? [await load_image(data.data.image)] : [];
    const prompt = processor.apply_chat_template(messages, {add_generation_prompt:true});
    const inputs = await processor(prompt, images);
    const output = await model.generate({...inputs, do_sample:false, max_new_tokens:700});
    const generated = output.slice(null, inputs.input_ids.dims[1]);
    const text = processor.batch_decode(generated, {skip_special_tokens:true})[0];
    self.postMessage({status:'complete',output:text});
  } catch (error) { self.postMessage({status:'error',data:error.message||String(error)}); }
};
