export function parseVersion(text){
 if(typeof text!=='string')throw Error('invalid version');const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text);
 if(!m)throw Error('invalid version');const prerelease=m[4]?.split('.')??[];
 if(prerelease.some(v=>/^\d+$/.test(v)&&v.length>1&&v[0]==='0'))throw Error('invalid numeric prerelease');
 const [major,minor,patch]=m.slice(1,4).map(Number);if(![major,minor,patch].every(Number.isSafeInteger))throw Error('invalid version');return{major,minor,patch,prerelease};
}
export function compareVersions(a,b){const x=parseVersion(a),y=parseVersion(b);for(const k of['major','minor','patch'])if(x[k]!==y[k])return x[k]<y[k]?-1:1;
 if(!x.prerelease.length&&!y.prerelease.length)return 0;if(!x.prerelease.length)return 1;if(!y.prerelease.length)return-1;
 for(let i=0;i<Math.max(x.prerelease.length,y.prerelease.length);i++){const a=x.prerelease[i],b=y.prerelease[i];if(a===undefined)return-1;if(b===undefined)return 1;if(a===b)continue;const an=/^\d+$/.test(a),bn=/^\d+$/.test(b);if(an!==bn)return an?-1:1;return an?(Number(a)<Number(b)?-1:1):(a<b?-1:1);}return 0;}
