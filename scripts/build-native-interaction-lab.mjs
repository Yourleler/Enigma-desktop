import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw new Error('Native acceptance fixture targets macOS');
const parent=path.resolve(process.argv[2]);
const root=fs.mkdtempSync(path.join(parent,'native-interaction-'));
const app=path.join(root,'Enigma Native Lab.app');
const mac=path.join(app,'Contents/MacOS');fs.mkdirSync(mac,{recursive:true});
const result=spawnSync('xcrun',['swiftc','tests/fixtures/interaction-lab/native-app.swift','-framework','AppKit','-o',path.join(mac,'EnigmaNativeLab')],{encoding:'utf8'});
fs.writeFileSync(path.join(root,'build.log'),(result.stdout||'')+(result.stderr||''));
if(result.status!==0){console.log(result.stderr);process.exit(result.status||1);}
const bundleId='com.enigma.native-lab.'+path.basename(root).replace(/[^a-z0-9]/gi,'').toLowerCase();
fs.writeFileSync(path.join(app,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>EnigmaNativeLab</string><key>CFBundleName</key><string>Enigma Native Lab</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
const signed=spawnSync('codesign',['--sign','-','--force',app],{encoding:'utf8'});if(signed.status!==0)throw new Error(signed.stderr);
const info={root,app,bundleId,executable:path.join(mac,'EnigmaNativeLab'),arguments:[root],built:true,launched:false};
fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info));
