import fs from 'node:fs/promises';

/** Load an explicitly selected compatible API configuration for live probes. */
export async function loadValidationModel(file = process.env.ENIGMA_MODEL_CONFIG) {
  if (!file) throw new Error('Set ENIGMA_MODEL_CONFIG to a Pi models.json file before running a live model probe');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  const providers = Object.entries(config.providers || {}).filter(([, value]) => Array.isArray(value.models) && value.models.length);
  const selected = process.env.ENIGMA_PROVIDER_ID ? providers.find(([id]) => id === process.env.ENIGMA_PROVIDER_ID) : providers[0];
  if (!selected) throw new Error('No matching configured provider');
  const [providerId, provider] = selected;
  const model = process.env.ENIGMA_MODEL_ID ? provider.models.find(model => model.id === process.env.ENIGMA_MODEL_ID) : provider.models[0];
  if (!model) throw new Error('No matching configured model');
  return { providerId, provider, model };
}
