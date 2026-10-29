import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeSecretFileSync} from '../shared/secret-fs.ts';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export function modelCapabilitySignature(model: any) {
  const declaredInput = model?.capabilityObservation?.declaredInput || model?.input || ['text'];
  return createHash('sha256').update(JSON.stringify({provider:model?.provider,id:model?.id,api:model?.api,baseUrl:model?.baseUrl||'',input:declaredInput})).digest('hex');
}

/** Verified runtime observations are separate from provider credentials and
 * user model definitions. Changing the endpoint/declaration invalidates them. */
export class ModelCapabilityObservations {
  file: string;
  constructor(profile: string) { this.file=path.join(profile,'model-capability-observations.json'); }
  read(): any[] {
    try { const value=JSON.parse(fs.readFileSync(this.file,'utf8')); return Array.isArray(value)?value:[]; }
    catch { return []; }
  }
  apply(model: any, now=Date.now(), records=this.read()) {
    const record=records.find(value=>value.signature===modelCapabilitySignature(model)&&value.images===true
      && Number.isFinite(value.observedAt)&&now>=value.observedAt&&now-value.observedAt<MAX_AGE_MS);
    if(!record)return model;
    return {...model,input:[...new Set([...(model.input||['text']),'image'])],
      capabilityObservation:{images:true,observedAt:record.observedAt,method:record.method,declaredInput:record.declaredInput}};
  }
  recordImageSupport(model: any, proof: {matched:boolean;imageSha256:string}, now=Date.now()) {
    if(proof.matched!==true||!/^[0-9a-f]{64}$/i.test(proof.imageSha256))throw new Error('A successful image readback is required');
    if(fs.existsSync(this.file)&&!Array.isArray(JSON.parse(fs.readFileSync(this.file,'utf8'))))throw new Error('Capability observation file has an unsupported format');
    const record={provider:model.provider,modelId:model.id,signature:modelCapabilitySignature(model),images:true,
      declaredInput:model.capabilityObservation?.declaredInput||model.input||['text'],observedAt:now,method:'synthetic-image-readback',imageSha256:proof.imageSha256};
    const next=this.read().filter(value=>!(value.provider===model.provider&&value.modelId===model.id));next.push(record);
    writeSecretFileSync(this.file,JSON.stringify(next,null,2)+'\n');return record;
  }
}
