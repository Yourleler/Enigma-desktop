import {Node,mergeAttributes} from '@tiptap/core';
export const ResourceBadge=Node.create({
 name:'resourceBadge',group:'inline',inline:true,atom:true,
 addAttributes(){return {label:{default:''},reference:{default:''},kind:{default:'repository'}};},
 renderText({node}){return `@${node.attrs.label}`;},
 parseHTML(){return [{tag:'span[data-resource-badge]'}];},
 renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-resource-badge':'',class:'enigma-resource-badge',title:HTMLAttributes.reference}),`@${HTMLAttributes.label}`];},
});
