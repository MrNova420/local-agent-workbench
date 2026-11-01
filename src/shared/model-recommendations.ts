export type FeaturedModel = { id: string; label: string; note: string };

const PRIORITY: Omit<FeaturedModel, 'id'>[] = [
  { label: 'Ornith 1.0 · 9B', note: 'Q4_K_M · your installed Hugging Face tag' },
  { label: 'Ornith 1.5 · 9B', note: 'Q4_K_M · your installed Hugging Face tag' },
  { label: 'UnderDog Saluki · 27B', note: 'Runtime reports IQ2_XS · source tag says IQ2 mix MTP' },
  { label: 'Qwen 3.8 Distill · 35B A3B', note: 'Runtime reports IQ4_XS · your installed i1 tag' },
  { label: 'Distill Abliterated Apex', note: 'IQ3_XXS · your installed Ollama tag' },
  { label: 'Distill Abliterated Apex Fast', note: 'IQ3_XXS · same weights, installed fast alias' },
  { label: 'Flint · GGUF', note: 'UD-IQ2_XXS · your installed tag' },
];

const EXACT_INSTALLED_TAGS = [
  'hf.co/PeppX/Ornith-1.0-9B-Uncensored-GGUF:Q4_K_M',
  'hf.co/mradermacher/Ornith-1.5-9B-uncensored-GGUF:Q4_K_M',
  'hf.co/Kujira/Underdog-Saluki-27B-1.0-MTP-Abliterated-GGUF:Underdog-Saluki-27B-1.0-IQ2-mix-MTP-abliterated.gguf',
  'hf.co/mradermacher/Qwen3.8-35B-A3B-Distill-i1-GGUF:i1-IQ4_XS',
  'distill-abliterated-apex:latest',
  'distill-abliterated-apex-fast:latest',
  'hf.co/unsloth/flint-GGUF:UD-IQ2_XXS',
] as const;

/** Show only the user's installed exact tags; never invent availability or download anything. */
export function featuredInstalledModels(installed: readonly string[]): FeaturedModel[] {
  const available = new Set(installed);
  return EXACT_INSTALLED_TAGS.flatMap((id, index) => available.has(id)
    ? [{ id, ...PRIORITY[index] }]
    : []);
}
