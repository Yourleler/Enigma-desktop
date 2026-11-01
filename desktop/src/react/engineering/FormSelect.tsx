import {SearchField} from '../ui/SearchField';
import { useId, useState } from 'react';
import { SelectWidget, type SelectOption } from '../ui/SelectWidget';
import styles from './FormLayout.module.css';

export function FormSelect({label,value,options,onChange,disabled=false,hint,fixed=false}:{
  label:string; value:string; options:SelectOption[]; onChange:(value:string)=>void;
  disabled?:boolean; hint?:string; fixed?:boolean;
}) {
  const id=useId();
  const selected=options.find(option=>option.value===value);
  return <div className={styles.field}>
    <span id={id} className={styles.label}>{label}</span>
    {fixed ? <div className={styles.fixed} aria-labelledby={id}>{selected?.label || value}</div> :
      <SelectWidget ariaLabelledBy={id} options={options} value={value} onChange={onChange}
        disabled={disabled || !options.length} className={styles.select} triggerClassName={styles.trigger}
        placeholder={options.length?'请选择':'暂无可用选项'} align="start" />}
    {hint&&<small className={styles.hint}>{hint}</small>}
  </div>;
}

export function FormSelectControl({label,value,options,onChange,disabled=false}:{label:string;value:string;options:SelectOption[];onChange:(value:string)=>void;disabled?:boolean}) {
  return <SelectWidget ariaLabel={label} options={options} value={value} onChange={onChange} disabled={disabled}
    className={styles.select} triggerClassName={styles.trigger} align="start" placeholder="请选择" />;
}

export function FormMultiChoice({label,options,value,onChange,empty}:{label:string;options:SelectOption[];value:string[];onChange:(value:string[])=>void;empty?:string}) {
  const [query,setQuery]=useState('');
  const shown=options.filter(option=>option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <fieldset className={styles.choices}><legend>{label} · 已选 {value.length}</legend>
    {options.length>6&&<SearchField className={styles.input} type="search" aria-label={`筛选${label}`} placeholder="按名称或供应商筛选" value={query} onChange={event=>setQuery(event.target.value)}/>}
    <div className={styles.choiceList}>{shown.map(option=><label className={styles.check} key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={event=>onChange(event.target.checked?[...value,option.value]:value.filter(item=>item!==option.value))}/><span>{option.label}</span></label>)}</div>
    {!shown.length&&<p className={styles.hint}>{options.length?'没有匹配项':empty||'暂无可选项'}</p>}
  </fieldset>;
}
