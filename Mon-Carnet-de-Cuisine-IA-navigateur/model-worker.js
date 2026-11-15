import { AutoProcessor, AutoModelForVision2Seq, load_image, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true;
const MODEL = 'HuggingFaceTB/SmolVLM-256M-Instruct';
let processorPromise, modelPromise;
async function getModel() {
  processorPromise ||= AutoProcessor.from_pretrained(MODEL, { progress_callback: p => self.postMessage({status:'progress', ...p}) });
  modelPromise ||= AutoModelForVision2Seq.from_pretrained(MODEL, { dtype:'fp32', device:'webgpu', progress_callback:p=>self.postMessage({status:'progress',...p}) });
  return Promise.all([processorPromise, modelPromise]);
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') { await getModel(); self.postMessage({status:'ready'}); return; }
    if (data.type !== 'generate') return;
    if (!navigator.gpu) throw new Error('Ce navigateur ne prend pas en charge WebGPU. Utilisez une version récente de Chrome ou Edge.');
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
