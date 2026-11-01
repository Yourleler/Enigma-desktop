import {forwardRef,type InputHTMLAttributes} from 'react';
import './SearchField.css';

/** Search fields share material and typography; their host owns placement. */
export const SearchField=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function SearchField({className='',...props},ref){
 return <input {...props} ref={ref} className={`enigma-search-surface ${className}`} data-field-surface="search"/>;
});
