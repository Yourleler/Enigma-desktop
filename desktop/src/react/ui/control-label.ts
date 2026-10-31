import {createContext,useContext} from 'react';

export const ControlLabelContext=createContext<{labelId?:string;descriptionId?:string}>({});
export const useControlLabel=()=>useContext(ControlLabelContext);
