import {get,set,del} from 'idb-keyval';
import { z } from 'zod';
import { profileSchema, defaultPreferences } from './types';
import type {Profile,Preferences,PlanResult} from './types';
const key='terp-path:v1';
const meeting=z.object({days:z.string().regex(/^[MTuWThFSaSu]+$/),start:z.number().int().min(0).max(1439),end:z.number().int().min(1).max(1440),location:z.string()}).refine(m=>m.start<m.end);
const term=z.string().regex(/^20\d{2}(01|05|08|12)$/);
export const preferencesSchema=z.object({start_term:term,target_term:term.nullable(),min_credits:z.number().int().min(0).max(24),max_credits:z.number().int().min(1).max(24),summer:z.boolean(),winter:z.boolean(),concentration:z.string().regex(/^[A-Z]{3,4}$/),interests:z.array(z.string()).max(20),excluded:z.array(z.string()).max(100),pinned:z.record(z.string(),term),pinned_sections:z.record(z.string(),z.string()),blocked:z.array(meeting).max(30),allow_full:z.boolean()}).refine(p=>p.min_credits<=p.max_credits&&(!p.target_term||p.target_term>=p.start_term),'Check term and credit limits');
const saved=z.object({version:z.literal(1),profile:profileSchema.nullable(),preferences:preferencesSchema});
export interface Workspace {version:1;profile:Profile|null;preferences:Preferences}
export async function restore():Promise<Workspace>{const value=await get(key);return value?saved.parse(value):{version:1,profile:null,preferences:defaultPreferences}}
export async function persist(profile:Profile|null,preferences:Preferences){await set(key,{version:1,profile,preferences})}
export async function forget(){await del(key)}
export function exportWorkspace(profile:Profile|null,preferences:Preferences){const blob=new Blob([JSON.stringify({version:1,profile,preferences},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='terp-path-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function importWorkspace(text:string):Workspace{return saved.parse(JSON.parse(text))}
// Generated plans are intentionally revalidated after restoration, rather than persisted as current.
export type {PlanResult};
