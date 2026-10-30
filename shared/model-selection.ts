export interface ModelSelection {
  provider:string;
  id:string;
  revision:number;
  state:'pending'|'applied'|'failed'|'cancelled';
  error?:string;
}
