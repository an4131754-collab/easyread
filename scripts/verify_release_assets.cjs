const fs=require('fs'),path=require('path'),crypto=require('crypto'),yaml=require('js-yaml');
const dir=path.resolve(process.argv[2]);
const platform=process.argv[3];
const expectedVersion=require('../package.json').version;
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk(dir),manifests=files.filter(p=>/^latest.*\.yml$/.test(path.basename(p)));
if(manifests.length!==(platform?1:3))throw Error('Unexpected number of update manifests');
for(const manifest of manifests){
 const data=yaml.load(fs.readFileSync(manifest,'utf8'));
 if(data.version!==expectedVersion)throw Error('Unexpected version in '+manifest);
 for(const item of data.files){
  const file=path.resolve(path.dirname(manifest),item.url);
  if(path.dirname(file)!==path.dirname(manifest))throw Error('Manifest path escaped platform folder');
  const bytes=fs.readFileSync(file);
  if(item.size!==bytes.length)throw Error('Size mismatch for '+file);
  if(crypto.createHash('sha512').update(bytes).digest('base64')!==item.sha512)throw Error('Hash mismatch for '+file);
 }
 console.log(path.basename(manifest)+': version '+expectedVersion+' and all asset SHA512/size checks passed');
}
const names=files.map(p=>path.basename(p));
const required = {
 Windows:[/\.exe$/,/\.exe\.blockmap$/],
 macOS:[/\.dmg$/,/mac\.zip$/],
 Linux:[/\.AppImage$/]
};
if(platform&&!required[platform])throw Error('Unsupported build platform');
for(const pattern of platform?required[platform]:Object.values(required).flat())
 if(!names.some(n=>pattern.test(n)))throw Error('Missing asset '+pattern);
console.log('Release asset names:',names.join(', '));
