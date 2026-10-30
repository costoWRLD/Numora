import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep QVAC's worker files beside this project instead of assuming that the
// Windows user profile already contains a .qvac directory.
const projectDir = path.dirname(fileURLToPath(import.meta.url));
process.env.HOME = projectDir;
process.env.USERPROFILE = projectDir;

const { completion, loadModel, unloadModel } = await import('@qvac/sdk');
const modelSrc = path.join(projectDir, '.qvac', 'models', 'Qwen2.5-3B-Instruct-Q4_K_M.gguf');

let modelId;
let lastReportedPercent = -1;

try {
  console.log('Loading Qwen2.5 3B Instruct Q4_K_M...');
  modelId = await loadModel({
    modelSrc,
    modelType: 'llamacpp-completion',
    modelConfig: { ctx_size: 4096, predict: 320, temp: 0.1, device: 'cpu', gpu_layers: 0, parallel: 1 },
    onProgress: ({ percentage }) => {
      const percent = Math.floor(percentage);
      if (percent % 10 === 0 && percent !== lastReportedPercent) {
        console.log(`Model download: ${percent}%`);
        lastReportedPercent = percent;
      }
    },
  });
  console.log('\nModel loaded. Asking a prompt locally...');

  const run = completion({
    modelId,
    history: [{ role: 'user', content: 'Say hello in one short sentence.' }],
    stream: false,
  });
  const answer = await run.final;
  console.log(`\nAnswer: ${answer.contentText}`);
} catch (error) {
  console.error('\nQVAC prompt test failed:', error);
  process.exitCode = 1;
} finally {
  if (modelId) {
    await unloadModel({ modelId }).catch((error) => {
      console.error('Could not unload the model cleanly:', error);
    });
  }
}
