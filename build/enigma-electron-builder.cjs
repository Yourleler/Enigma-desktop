/** Product overlay preserves upstream build machinery while isolating Enigma
 * identity and update destination. Existing signature/seed verification stays
 * mandatory; this configuration never publishes or installs by itself.
 */
const base=require('../package.json').build;
module.exports={...base,appId:'com.yourleler.enigma',productName:'Enigma',directories:{...base.directories,output:'dist-enigma'},extraMetadata:{...base.extraMetadata,enigmaProduct:true,description:'Personal coding agent with multi-repository coordination, source reading and managed recovery'},publish:[{provider:'github',owner:'Yourleler',repo:'Enigma-desktop'}],dmg:{...base.dmg,title:'Enigma'},win:{...base.win,executableName:'Enigma'},nsis:{...base.nsis,shortcutName:'Enigma'}};
