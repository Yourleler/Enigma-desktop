const path=require('path');
const os=require('os');
function isEnigmaProduct(environment=process.env,metadata={}){return environment.ENIGMA_DESKTOP_PRODUCT==='1'||metadata.enigmaProduct===true;}
function productIdentity(environment=process.env,metadata={}){const enigma=isEnigmaProduct(environment,metadata);return enigma?{name:'Enigma',appId:'com.yourleler.enigma',home:path.join(os.homedir(),'.enigma-desktop'),owner:'Yourleler',repository:'Enigma-desktop',inviteApi:''}:{name:'HanaAgent',appId:'com.hanako.app',home:path.join(os.homedir(),'.hanako'),owner:'liliMozi',repository:'openhanako',inviteApi:'https://alpha-invite-gate.hanaagent.workers.dev'};}
module.exports={isEnigmaProduct,productIdentity};
