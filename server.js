'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const rooms=new Map(), file=path.join(process.env.DATA_DIR||__dirname,'rooms.json');
const uid=()=>crypto.randomBytes(18).toString('hex'), now=()=>Date.now();
try{for(const [code,world] of JSON.parse(fs.readFileSync(file,'utf8'))){world.cashier=null;for(const h of Object.values(world.hands||{}))if(h&&world.S.stock[h.id])world.S.stock[h.id].back+=h.n;world.hands={};rooms.set(code,{world,players:new Map(),lock:null,rev:0,touched:now()})}}catch{}
function persist(){try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify([...rooms].map(([k,r])=>[k,r.world])));fs.renameSync(file+'.tmp',file)}catch(e){console.error('Save:',e.message)}}
setInterval(persist,5000).unref();
function remove(r,id){if(r.lock?.id===id)r.lock=null;let h=r.world.hands?.[id];if(h&&r.world.S.stock[h.id])r.world.S.stock[h.id].back+=h.n;delete r.world.hands[id];if(r.world.cashier?.owner===id)r.world.cashier=null;r.players.delete(id);r.rev++}
function clean(r){if(r.lock&&r.lock.until<now())r.lock=null;for(const [id,p] of r.players)if(now()-p.seen>22000&&!r.lock)remove(r,id)}
function leader(r){return r.players.keys().next().value||null}
function packet(r,id){return {rev:r.rev,world:r.world,leader:leader(r),players:[...r.players].map(([id,p])=>({id,name:p.name,...p.pos}))}}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){let a=[],n=0;for await(const b of req){n+=b.length;if(n>400000)throw Error('İstek çok büyük');a.push(b)}return JSON.parse(Buffer.concat(a).toString()||'{}')}
function valid(w){return w&&w.S&&Number.isFinite(w.S.cash)&&Number.isFinite(w.S.day)&&w.S.stock&&Array.isArray(w.S.fixtures)&&Array.isArray(w.customers)&&w.customers.length<=3&&Array.isArray(w.queue)&&w.hands&&Object.keys(w.hands).length<=4}
function add(r,name){const id=uid();r.players.set(id,{name:String(name||'Oyuncu').trim().slice(0,20)||'Oyuncu',secret:uid(),seen:now(),pos:{x:0,z:2.9,yaw:0,moving:false}});return id}
const server=http.createServer(async(req,res)=>{try{let url=new URL(req.url,'http://localhost');if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')))}if(req.method==='GET'&&url.pathname==='/health')return reply(res,200,{ok:true});if(req.method!=='POST'||!url.pathname.startsWith('/api/'))return reply(res,404,{error:'Bulunamadı'});let b=await body(req),op=url.pathname.slice(5),r,code,id;
if(op==='create'){if(rooms.size>=150)return reply(res,503,{error:'Oda sınırı dolu'});if(!valid(b.world))return reply(res,400,{error:'Geçersiz market'});do{code=String(crypto.randomInt(100000,1000000))}while(rooms.has(code));r={world:b.world,players:new Map(),lock:null,rev:0,touched:now()};r.world.hands={};r.world.cashier=null;rooms.set(code,r);id=add(r,b.name);return reply(res,200,{code,id,secret:r.players.get(id).secret,...packet(r,id)})}
code=String(b.code||'');r=rooms.get(code);if(!r)return reply(res,404,{error:'Oda bulunamadı'});clean(r);r.touched=now();if(op==='join'){if(r.players.size>=4)return reply(res,409,{error:'Oda dolu (4/4)'});id=add(r,b.name);return reply(res,200,{code,id,secret:r.players.get(id).secret,...packet(r,id)})}
id=b.id;let p=r.players.get(id);if(!p||p.secret!==b.secret)return reply(res,403,{error:'Bağlantı sona erdi. Odaya tekrar katıl.'});p.seen=now();if(b.pos&&['x','z','yaw'].every(k=>Number.isFinite(b.pos[k]))){p.pos={x:Math.max(-12,Math.min(12,b.pos.x)),z:Math.max(-8,Math.min(14,b.pos.z)),yaw:b.pos.yaw,moving:!!b.pos.moving}}
if(op==='poll')return reply(res,200,packet(r,id));if(op==='leave'){if(r.lock&&r.lock.id!==id)return reply(res,409,{error:'İşlem sürüyor'});remove(r,id);return reply(res,200,{ok:true})}
if(op==='claim'){if(b.sim&&leader(r)!==id)return reply(res,409,{error:'Simülasyon yöneticisi değişti'});if(r.lock)return reply(res,409,{error:'Meşgul'});r.lock={id,token:uid(),until:now()+6000};return reply(res,200,{...packet(r,id),token:r.lock.token})}
if(op==='cancel'){if(r.lock?.id===id&&r.lock.token===b.token)r.lock=null;return reply(res,200,{ok:true})}
if(op==='commit'){if(r.lock?.id!==id||r.lock.token!==b.token||r.lock.until<now())return reply(res,409,{error:'İşlem süresi doldu'});if(!valid(b.world)){r.lock=null;return reply(res,400,{error:'Geçersiz durum'})}r.world=b.world;r.rev++;r.lock=null;return reply(res,200,packet(r,id))}return reply(res,404,{error:'Bilinmeyen işlem'});
}catch(e){reply(res,400,{error:'İstek işlenemedi'})}});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Market online: port '+(process.env.PORT||3000)));process.on('SIGTERM',()=>{persist();server.close(()=>process.exit(0))});
