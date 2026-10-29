import net from 'node:net';
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export async function connectBidi(port){
  let socket;
  for(let i=0;i<100;i++){try{socket=await new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/session`);ws.addEventListener('open',()=>resolve(ws),{once:true});ws.addEventListener('error',reject,{once:true});});break;}catch{await delay(100);}}
  if(!socket)throw Error('Firefox BiDi did not start');
  let nextId=0;const pending=new Map(),listeners=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id!==undefined){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
      message.type==='error'?item.reject(new Error(`${message.error}: ${message.message}`)):item.resolve(message.result);
    }else if(message.method){listeners.get(message.method)?.(message.params);}
  });
  return{close:()=>socket.close(),on:(event,listener)=>listeners.set(event,listener),command:(method,params={})=>new Promise((resolve,reject)=>{
    const id=++nextId;pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('BiDi command timed out: '+method));},20000)});
    socket.send(JSON.stringify({id,method,params}));
  })};
}
