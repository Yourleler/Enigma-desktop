/** Display metadata only. The original input remains the model/clipboard source. */
export interface ContextHandoff {
  goal: string;
  mode: 'background' | 'continue' | 'alternative';
  notes: {role:'user'|'assistant'|'source';kind:string;text:string;reference:string}[];
  repositories: string[];
}
