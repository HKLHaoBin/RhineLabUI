import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import * as T from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {configureInternalOptics} from "../src/internal-optics.ts";
async function load(path){const b=await readFile(new URL(path,import.meta.url));const s=(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),"")).scene;s.updateMatrixWorld(true);return s;}
const [before,after]=await Promise.all([load("../reference/internal-study/assembly-before.glb"),load("../public/assets/archive-assembly.glb")]);
function external(scene){const rows=new Map();scene.traverse(m=>{if(!m.isMesh||["optical-core","optical-lenses"].includes(m.userData.assemblyPart))return;const key=m.userData.assemblyPart+":"+m.material.name.replace(/\.\d+$/,"");const values=rows.get(key)||[];const p=m.geometry.attributes.position,n=m.geometry.attributes.normal,normalMatrix=new T.Matrix3().getNormalMatrix(m.matrixWorld);for(let i=0;i<p.count;i++)values.push([new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld),new T.Vector3().fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix)]);rows.set(key,values)});return rows;}
const old=external(before),current=external(after);assert.deepEqual([...current.keys()].sort(),[...old.keys()].sort());
let maxExternalPositionError=0,maxExternalNormalError=0;
for(const [name,points] of current){const prior=old.get(name);for(const [p,n] of points){let distance=Infinity,normalError=Infinity;for(const [op,on] of prior){const d=p.distanceTo(op);if(d<1e-5){distance=Math.min(distance,d);normalError=Math.min(normalError,n.distanceTo(on));}}maxExternalPositionError=Math.max(maxExternalPositionError,distance);maxExternalNormalError=Math.max(maxExternalNormalError,normalError);}}
assert.ok(maxExternalPositionError<1e-5,"Outer shell geometry is unchanged");assert.ok(maxExternalNormalError<1e-4,"Outer shell shading normals are unchanged");
let minSectionNormalDot=1,glassMeshes=0,bridgeMeshes=0;
after.traverse(m=>{if(!m.isMesh||!/^Optical_(Glass_|Bridge_Glass)/.test(m.material.name))return;const p=m.geometry.attributes.position,n=m.geometry.attributes.normal,ix=m.geometry.index;
for(let i=0;i<ix.count;i+=3){const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)],ps=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j)),face=ps[1].sub(ps[0]).cross(ps[2].sub(ps[0])).normalize();if(face.lengthSq()<.5)continue;for(const id of ids)minSectionNormalDot=Math.min(minSectionNormalDot,face.dot(new T.Vector3().fromBufferAttribute(n,id)));}
configureInternalOptics(m.material.name.replace(/\.\d+$/,""),m.material);assert.equal(m.material.transmission,0);assert.equal(m.material.transparent,false);assert.equal(m.material.blending,T.CustomBlending);assert.equal(m.material.depthWrite,false);assert.equal(m.material.side,T.FrontSide);assert.ok(m.material.opacity>0&&m.material.opacity<1);glassMeshes++;if(m.material.name.startsWith("Optical_Bridge_Glass"))bridgeMeshes++;
});
assert.ok(minSectionNormalDot>.995,"The baked normal does not round over hard profile edges");assert.equal(glassMeshes,4);assert.equal(bridgeMeshes,1,"One continuous bridge replaces the separate narrow strips");
console.log(JSON.stringify({passed:true,maxExternalPositionError,maxExternalNormalError,minSectionNormalDot,glassMeshes,bridgeMeshes},null,2));
